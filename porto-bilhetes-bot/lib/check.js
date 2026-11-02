import { SOURCES, BUY_URL, MAX_NEW_PER_RUN, DEDUPE_WINDOW_HOURS, FAIL_ALERT_AFTER, REMIND_BEFORE_MIN } from './config.js';
import { readSource, activeSources } from './sources.js';
import { signature, similar } from './parse.js';
import { parseSaleTime, formatWhen, pageText } from './when.js';
import { escapeHtml } from './telegram.js';

// ── Mensagens ────────────────────────────────────────────────
function whenLines(timing) {
  if (!timing) return [];
  if (timing.status === 'now') return ['🚨 <b>JÁ À VENDA!</b>'];
  if (timing.status === 'scheduled') {
    const when = formatWhen(timing.at, timing.hasTime);
    const remind = timing.hasTime
      ? `⏰ Lembro-te ${REMIND_BEFORE_MIN} min antes e quando abrir.`
      : '⏰ Lembro-te nesse dia de manhã (a hora não foi indicada).';
    return [`📅 <b>A venda abre ${when}</b>`, remind];
  }
  return ['ℹ️ Hora de abertura não indicada, vê o anúncio.'];
}

export function formatAlert(item) {
  return [
    '🎟️🔵⚪ <b>FC Porto — bilhetes</b>',
    ...(item.timing ? ['', ...whenLines(item.timing)] : []),
    '',
    `<b>${escapeHtml(item.title)}</b>`,
    '',
    `📍 ${escapeHtml(item.sourceName)}${item.extra ? ` · ${escapeHtml(item.extra)}` : ''}`,
    `🔗 <a href="${escapeHtml(item.url)}">Abrir o anúncio</a>`,
    `🛒 <a href="${BUY_URL}">Ir à bilheteira</a>`,
  ].join('\n');
}

export function formatReminder(r) {
  const head = {
    before: `⏰ <b>Faltam ${REMIND_BEFORE_MIN} min para abrir a venda!</b>`,
    open: '🟢 <b>A venda de bilhetes ABRIU agora!</b>',
    day: '📅 <b>É hoje que abre a venda de bilhetes!</b>',
  }[r.kind];
  const lines = [head, '', `<b>${escapeHtml(r.title)}</b>`];
  if (r.kind === 'before') lines.push(`🕐 Abre às ${formatWhen(r.saleAt, true).split(' às ')[1]}`);
  if (r.kind === 'day') lines.push('🕐 Hora não indicada, vai espreitando a bilheteira.');
  lines.push('', `🛒 <a href="${BUY_URL}">Ir à bilheteira</a>`, `🔗 <a href="${escapeHtml(r.url)}">Anúncio original</a>`);
  return lines.join('\n');
}

// ── Hora da venda ────────────────────────────────────────────
const better = (a, b) => {
  const score = (t) => (t.status === 'scheduled' ? (t.hasTime ? 3 : 2) : t.status === 'now' ? 1 : 0);
  return score(b) > score(a) ? b : a;
};

async function resolveTiming(item, fetcher, now, budget) {
  let timing = parseSaleTime(item.title, now);
  // Nas fontes oficiais com página própria, lê o corpo do anúncio se o título não chegar.
  const needsMore = timing.status !== 'scheduled' || !timing.hasTime;
  if (needsMore && item.type === 'links' && budget.pages > 0) {
    budget.pages--;
    try {
      const html = await fetcher(item.url);
      timing = better(timing, parseSaleTime(pageText(html, item.title), now));
    } catch { /* fica com o que veio do título */ }
  }
  // Um jogo novo na bilheteira sem data futura = já se pode comprar.
  if (item.sourceId === 'bilheteira' && timing.status === 'unknown') timing = { status: 'now', hasTime: false };
  return timing;
}

async function scheduleReminders(store, item, timing, now) {
  if (timing.status !== 'scheduled') return;
  const base = { title: item.title, url: item.url, saleAt: timing.at };
  if (timing.hasTime) {
    const before = timing.at - REMIND_BEFORE_MIN * 60_000;
    if (before > now + 5 * 60_000) await store.addReminder(before, { ...base, kind: 'before' });
    await store.addReminder(timing.at, { ...base, kind: 'open' });
  } else {
    await store.addReminder(timing.at, { ...base, kind: 'day' }); // 9h00 desse dia
  }
}

async function broadcast(store, send, html) {
  let sent = 0;
  for (const chat of await store.getSubscribers()) {
    const r = await send(chat, html);
    if (r === 'ok') sent++;
    if (r === 'blocked') await store.removeSubscriber(chat);
  }
  return sent;
}

/**
 * Corre uma verificação: envia lembretes que chegaram à hora e procura anúncios novos.
 * deps: { store, fetcher, send(chatId, html) → 'ok'|'blocked'|'error', admin?, now? }
 */
export async function runCheck({ store, fetcher, send, admin = null, now = Date.now(), sources: allSources = SOURCES }) {
  const sources = activeSources(allSources);
  let sent = 0;

  // 1) Lembretes que já chegaram à hora (ignora os muito atrasados, ex.: se o cron esteve parado).
  const due = await store.popDueReminders(now);
  const remindersSent = [];
  for (const r of due) {
    if (now - r.at > 2 * 3600_000) continue;
    sent += await broadcast(store, send, formatReminder(r));
    remindersSent.push(`${r.kind}: ${r.title}`);
  }

  // 2) Ler as fontes.
  const status = await store.getStatus();
  const warnings = [];
  const candidates = [];
  const report = {};
  const results = await Promise.allSettled(sources.map((s) => readSource(s, fetcher, now, store)));

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const res = results[i];

    if (res.status === 'rejected') {
      const msg = String(res.reason?.message || res.reason);
      const fails = await store.incrFail(src.id);
      await store.setStatus(src.id, { ok: false, at: now, error: msg, fails });
      if (fails === FAIL_ALERT_AFTER) {
        warnings.push(`⚠️ A fonte <b>${escapeHtml(src.name)}</b> falhou ${fails} vezes seguidas: ${escapeHtml(msg)}`);
      }
      report[src.id] = { ok: false, error: msg };
      continue;
    }

    const items = res.value;
    if (status[src.id] && status[src.id].ok === false) await store.resetFail(src.id);

    const seen = await store.getSeen(src.id);
    const fresh = items.filter((it) => !seen.has(it.key));
    const initialized = await store.isInitialized(src.id);

    let notify = fresh;
    let note = '';
    if (!initialized) {
      notify = [];
      note = 'primeira leitura: itens atuais guardados sem avisar';
      await store.markInitialized(src.id);
    } else if (src.official && src.type === 'links' && fresh.length > MAX_NEW_PER_RUN) {
      notify = [];
      note = `${fresh.length} links novos de uma vez — provável mudança no site, ignorados`;
      warnings.push(`⚠️ <b>${escapeHtml(src.name)}</b>: ${fresh.length} links novos de uma vez. O site deve ter mudado de layout; guardei-os sem avisar.`);
    }

    await store.saveSeen(src.id, items.map((it) => it.key), now);
    await store.setStatus(src.id, { ok: true, at: now, count: items.length, fresh: fresh.length, note });
    report[src.id] = { ok: true, count: items.length, fresh: fresh.length, notified: notify.length, note };

    for (const it of notify) {
      candidates.push({ ...it, sourceId: src.id, type: src.type, sourceName: src.name, official: !!src.official });
    }
  }

  // 3) Tirar repetidos (a mesma notícia em vários jornais). Oficiais primeiro e sempre enviados.
  candidates.sort((a, b) => Number(b.official) - Number(a.official));
  const recent = (await store.getRecent()).filter((r) => now - r.at <= DEDUPE_WINDOW_HOURS * 3600_000);
  const toSend = [];
  for (const c of candidates) {
    const sig = signature(c.title);
    const dup = recent.some((r) => similar(sig, r.sig));
    if (dup && !c.official) continue;
    const entry = { sig, at: now, title: c.title };
    recent.unshift(entry);
    await store.addRecent(entry);
    toSend.push(c);
  }

  // 4) Descobrir quando abre a venda, avisar e agendar lembretes.
  const budget = { pages: 3 };
  for (const item of toSend) {
    item.timing = await resolveTiming(item, fetcher, now, budget);
    await scheduleReminders(store, item, item.timing, now);
    sent += await broadcast(store, send, formatAlert(item));
  }

  if (admin && warnings.length) {
    for (const w of warnings) await send(admin, w);
  }

  return {
    at: new Date(now).toISOString(),
    alerts: toSend.map((t) => t.title),
    timings: toSend.map((t) => ({ title: t.title, status: t.timing.status, at: t.timing.at ? new Date(t.timing.at).toISOString() : null })),
    reminders: remindersSent,
    messagesSent: sent,
    sources: report,
  };
}

// Para o comando /vendas: próximas aberturas agendadas.
export async function upcomingSales(store, now = Date.now()) {
  const list = await store.getUpcomingReminders(now);
  return list.filter((r) => r.kind !== 'before').sort((a, b) => a.saleAt - b.saleAt);
}
