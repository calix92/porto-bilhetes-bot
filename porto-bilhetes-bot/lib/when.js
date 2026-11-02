// Descobre QUANDO abre a venda a partir do texto de um anúncio.
// Ex.: "à venda a partir das 15h00 desta sexta-feira" → sexta às 15:00 (hora de Lisboa).
import { normalize } from './parse.js';

const TZ = 'Europe/Lisbon';
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// ── Hora de Lisboa ───────────────────────────────────────────
function lisbonParts(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  const y = +p.year, m = +p.month, d = +p.day;
  return { y, m, d, h: +p.hour, mi: +p.minute, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

// Converte uma data/hora "de Lisboa" em milissegundos UTC (trata da hora de verão).
export function lisbonToUtc(y, m, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ms) => {
    const p = lisbonParts(ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return ms;
}

const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export function formatWhen(ms, hasTime = true) {
  const p = lisbonParts(ms);
  const today = lisbonParts(Date.now());
  const tomorrow = addDays(today, 1);
  let day = `${WEEKDAY_NAMES[p.dow]}, ${p.d}/${p.m}`;
  if (p.y === today.y && p.m === today.m && p.d === today.d) day = `hoje (${day})`;
  else if (p.y === tomorrow.y && p.m === tomorrow.m && p.d === tomorrow.d) day = `amanhã (${day})`;
  return hasTime ? `${day} às ${String(p.h).padStart(2, '0')}h${String(p.mi).padStart(2, '0')}` : day;
}

// ── Extração ─────────────────────────────────────────────────
const ANCHOR = /(a venda|venda|vende|disponive|disponibiliz|adquirir|comprar|arranca|abre |abertura)/;
const NOW_PHRASES = /(ja (estao |esta |se encontram )?a venda|ja (estao |esta )?disponive|colocou (hoje )?a venda|estao a venda|esta a venda|abriu a venda|arrancou a venda|venda arrancou|venda abriu|ja pode(s|m)? comprar|venda (ja )?(esta )?aberta)/;

function findAll(re, s) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(s))) out.push(m);
  return out;
}

// Datas/horas logo a seguir a "marcado para", "jogo", "disputa"... são do JOGO, não da venda.
const GAME_CONTEXT = /(marcad|agendad|disputa|jogo|partida|encontro|embate|duelo|realiza|joga|apito|pontape)[^,.;]{0,25}$/;

function closest(cands, anchor, s) {
  let best = null;
  for (const c of cands) {
    let dist = Math.abs(c.pos - anchor) - (c.bonus || 0);
    if (c.pos > anchor) dist -= 10; // a venda costuma vir antes da data: "à venda amanhã"
    if (GAME_CONTEXT.test(s.slice(Math.max(0, c.pos - 40), c.pos))) dist += 120;
    if (!best || dist < best.dist) best = { ...c, dist };
  }
  return best && best.dist <= 160 ? best : null;
}

function extractTimes(s) {
  const cands = [];
  const push = (m, hh, mm, bonus = 0) => {
    const h = +hh, mi = mm ? +mm : 0;
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) cands.push({ pos: m.index, h, mi, bonus });
  };
  for (const m of findAll(/a partir das (\d{1,2})(?:\s*[h:]\s*(\d{2})|\s*h(?:oras)?)?/, s)) push(m, m[1], m[2], 100);
  for (const m of findAll(/\b(?:as|pelas) (\d{1,2})(?:\s*[h:]\s*(\d{2})|\s*h(?:oras)?\b)/, s)) push(m, m[1], m[2], 20);
  for (const m of findAll(/\b(\d{1,2})h(\d{2})?\b/, s)) push(m, m[1], m[2]);
  for (const m of findAll(/\b(\d{1,2}):(\d{2})\b/, s)) push(m, m[1], m[2]);
  return cands;
}

function extractDays(s, today) {
  const cands = [];
  for (const m of findAll(/\bhoje\b/, s)) cands.push({ pos: m.index, date: today, explicit: 'hoje' });
  for (const m of findAll(/\bdepois de amanha\b/, s)) cands.push({ pos: m.index, date: addDays(today, 2), bonus: 5 });
  for (const m of findAll(/(?<!depois de )\bamanha\b/, s)) cands.push({ pos: m.index, date: addDays(today, 1) });
  for (const m of findAll(/\b(segunda|terca|quarta|quinta|sexta)(?:[- ]feira)?\b|\b(sabado|domingo)\b/, s)) {
    const target = WEEKDAYS[m[1] || m[2]];
    cands.push({ pos: m.index, date: addDays(today, (target - today.dow + 7) % 7) });
  }
  for (const m of findAll(new RegExp(`\\b(?:dia )?(\\d{1,2}) de (${MONTHS.join('|')})\\b`), s)) {
    const mon = MONTHS.indexOf(m[2]) + 1;
    const year = mon < today.m - 6 ? today.y + 1 : today.y;
    cands.push({ pos: m.index, date: { y: year, m: mon, d: +m[1] }, bonus: 5 });
  }
  for (const m of findAll(/\bdia (\d{1,2})\b(?! de)/, s)) {
    const d = +m[1];
    if (d < 1 || d > 31) continue;
    const date = d >= today.d
      ? { y: today.y, m: today.m, d }
      : { y: today.m === 12 ? today.y + 1 : today.y, m: today.m === 12 ? 1 : today.m + 1, d };
    cands.push({ pos: m.index, date });
  }
  for (const m of findAll(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/, s)) {
    const d = +m[1], mon = +m[2];
    if (mon < 1 || mon > 12 || d < 1 || d > 31) continue;
    let y = m[3] ? +m[3] : today.y;
    if (y < 100) y += 2000;
    if (!m[3] && mon < today.m - 6) y++;
    cands.push({ pos: m.index, date: { y, m: mon, d } });
  }
  return cands;
}

/**
 * Devolve { status: 'now' | 'scheduled' | 'unknown', at?, hasTime }
 *  now        → a venda já está aberta
 *  scheduled  → abre no futuro, em `at` (ms UTC)
 *  unknown    → o texto não diz quando
 */
export function parseSaleTime(text, now = Date.now()) {
  const full = normalize(text).replace(/à/g, 'a');
  const isNow = NOW_PHRASES.test(full);
  const today = lisbonParts(now);

  const sentences = full.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  let day = null, time = null;
  for (const s of sentences) {
    const a = s.match(ANCHOR);
    if (!a) continue;
    day = closest(extractDays(s, today), a.index, s);
    time = closest(extractTimes(s), a.index, s);
    if (day || time) break;
  }
  if (!day && !time) return { status: isNow ? 'now' : 'unknown', hasTime: false };

  const date = day ? day.date : today;
  if (!time) {
    // Só o dia: se é hoje (ou já passou), está a abrir/aberta; se é no futuro, fica agendado sem hora.
    const at = lisbonToUtc(date.y, date.m, date.d, 9, 0);
    const startOfDay = lisbonToUtc(date.y, date.m, date.d, 0, 0);
    if (startOfDay <= now) return { status: 'now', hasTime: false };
    return { status: 'scheduled', at, hasTime: false };
  }

  const at = lisbonToUtc(date.y, date.m, date.d, time.h, time.mi);
  if (at <= now + 2 * 60_000) return { status: 'now', hasTime: true, at };
  return { status: 'scheduled', at, hasTime: true };
}

// Tira o texto principal de uma página HTML (para ler o corpo de uma notícia).
export function pageText(html, title = '') {
  const text = String(html)
    .replace(/<(script|style|noscript|template|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ');
  // Se encontrar o título na página, lê a partir daí (evita menus e outras notícias).
  const n = normalize(text);
  const key = normalize(title).slice(0, 40);
  const i = key ? n.indexOf(key) : -1;
  return n.slice(Math.max(0, i), Math.max(0, i) + 4000);
}
