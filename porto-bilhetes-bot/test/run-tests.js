// npm test → testa a lógica com dados simulados (sem internet).
import assert from 'node:assert/strict';
import { parseRss, parseLinks, passesFilter, signature, similar } from '../lib/parse.js';
import { runCheck } from '../lib/check.js';
import { memoryStore } from '../lib/store.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
};

const NOW = Date.parse('2026-11-02T12:00:00Z');
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `
<item><title>${i.t} - ${i.o}</title><link>${i.l}</link>
<pubDate>${new Date(i.d ?? NOW - 3600_000).toUTCString()}</pubDate>
<source url="https://x.pt">${i.o}</source></item>`).join('')}</channel></rss>`;

const page = (links) => `<html><body><nav><a href="/login">Entrar</a><a href="/">Início</a>
<a href="/faq">FAQ</a></nav>${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}
<a href="https://outro-site.pt/x">Externo</a></body></html>`;

const SOURCES = [
  { id: 'bilheteira', name: 'Bilheteira', type: 'links', url: 'https://bilhetes.fcporto.pt/', official: true, filter: 'none' },
  { id: 'site', name: 'Site', type: 'links', url: 'https://www.fcporto.pt/pt', official: true, filter: 'ticket' },
  { id: 'noticias', name: 'Notícias', type: 'rss', url: 'https://news/rss', official: false, filter: 'ticket+sale', maxAgeHours: 36 },
];

function harness(pages) {
  const sent = [];
  return {
    sent,
    pages,
    deps: (store) => ({
      store, sources: SOURCES, now: NOW,
      fetcher: async (url) => {
        const p = pages[url];
        if (p instanceof Error) throw p;
        return p;
      },
      send: async (chat, html) => { sent.push({ chat, html }); return chat === 'bloqueado' ? 'blocked' : 'ok'; },
      admin: 'admin',
    }),
  };
}

await test('RSS: tira o nome do jornal do título e lê a data', () => {
  const items = parseRss(rss([{ t: 'FC Porto: bilhetes à venda', o: 'A Bola', l: 'https://n/1' }]));
  assert.equal(items[0].title, 'FC Porto: bilhetes à venda');
  assert.equal(items[0].outlet, 'A Bola');
  assert.ok(items[0].publishedAt > 0);
});

await test('Links: só do mesmo site, absolutos e sem duplicados', () => {
  const l = parseLinks(page([['/evento/123', 'FC Porto x Benfica'], ['/evento/123#top', 'FC Porto x Benfica — comprar']]), 'https://bilhetes.fcporto.pt/');
  const ev = l.filter((x) => x.url.includes('evento'));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].url, 'https://bilhetes.fcporto.pt/evento/123');
  assert.ok(!l.some((x) => x.url.includes('outro-site')));
});

await test('Filtros: menus ignorados, notícias negativas cortadas', () => {
  assert.equal(passesFilter({ url: 'https://b/login', title: 'Entrar' }, 'none'), false);
  assert.equal(passesFilter({ url: 'https://b/evento/1', title: 'Jogo' }, 'none'), true);
  assert.equal(passesFilter({ url: 'x', title: 'Bilhetes para o Benfica à venda sexta' }, 'ticket+sale'), true);
  assert.equal(passesFilter({ url: 'x', title: 'Buscas na Loja: venda ilegal de bilhetes' }, 'ticket+sale'), false);
  assert.equal(passesFilter({ url: 'x', title: 'Venda de jogador ao Benfica' }, 'ticket+sale'), false);
  assert.equal(passesFilter({ url: 'x', title: 'FC Porto esgota bilhetes' }, 'ticket+sale'), false);
});

await test('Deduplicação: mesmo jogo junta, jogos diferentes não', () => {
  const a = signature('FC Porto: bilhetes para o clássico com o Benfica à venda sexta-feira');
  const b = signature('Bilhetes para o clássico com o Benfica já à venda');
  const c = signature('FC Porto: bilhetes para o clássico com o Sporting à venda sexta-feira');
  assert.ok(similar(a, b), 'Benfica/Benfica devia juntar');
  assert.ok(!similar(a, c), 'Benfica/Sporting não devia juntar');
});

await test('Fluxo completo: 1.ª leitura silenciosa, depois avisa só o que é novo', async () => {
  const store = memoryStore();
  await store.addSubscriber('111');
  await store.addSubscriber('bloqueado');
  const h = harness({
    'https://bilhetes.fcporto.pt/': page([['/evento/1', 'FC Porto x Arouca']]),
    'https://www.fcporto.pt/pt': page([['/pt/noticias/a', 'Bilhetes à venda para o Arouca']]),
    'https://news/rss': rss([{ t: 'FC Porto: bilhetes para o Arouca à venda', o: 'A Bola', l: 'https://n/old' }]),
  });

  const r1 = await runCheck(h.deps(store));
  assert.equal(h.sent.length, 0, 'primeira leitura não deve avisar');
  assert.deepEqual(r1.alerts, []);

  // Sai um jogo novo na bilheteira + notícia no site + 2 notícias nos jornais.
  h.pages['https://bilhetes.fcporto.pt/'] = page([['/evento/1', 'FC Porto x Arouca'], ['/evento/2', 'FC Porto x Benfica']]);
  h.pages['https://www.fcporto.pt/pt'] = page([['/pt/noticias/a', 'Bilhetes à venda para o Arouca'], ['/pt/noticias/b', 'Bilhetes para o clássico com o Benfica à venda']]);
  h.pages['https://news/rss'] = rss([
    { t: 'FC Porto: bilhetes para o Arouca à venda', o: 'A Bola', l: 'https://n/old' },
    { t: 'Bilhetes para o clássico com o Benfica já à venda', o: 'Record', l: 'https://n/new1' },
    { t: 'Bilhetes para o Liverpool à venda segunda-feira', o: 'O Jogo', l: 'https://n/new2' },
    { t: 'Notícia velha: bilhetes à venda para a Supertaça', o: 'Record', l: 'https://n/velha', d: NOW - 5 * 86400_000 },
  ]);

  const r2 = await runCheck(h.deps(store));
  assert.deepEqual(r2.alerts, ['FC Porto x Benfica', 'Bilhetes para o clássico com o Benfica à venda', 'Bilhetes para o Liverpool à venda segunda-feira']);
  assert.equal(r2.messagesSent, 3);
  assert.ok(!(await store.getSubscribers()).includes('bloqueado'), 'quem bloqueou o bot deve ser removido');
  assert.ok(h.sent[0].html.includes('bilhetes.fcporto.pt'));

  // Sem novidades → silêncio.
  h.sent.length = 0;
  const r3 = await runCheck(h.deps(store));
  assert.equal(h.sent.length, 0);
  assert.deepEqual(r3.alerts, []);
});

await test('Proteção anti-spam se o site mudar de layout', async () => {
  const store = memoryStore();
  await store.addSubscriber('111');
  const h = harness({
    'https://bilhetes.fcporto.pt/': page([['/evento/1', 'A']]),
    'https://www.fcporto.pt/pt': page([]),
    'https://news/rss': rss([]),
  });
  await runCheck(h.deps(store));
  h.pages['https://bilhetes.fcporto.pt/'] = page(Array.from({ length: 20 }, (_, i) => [`/novo/${i}`, `Item ${i}`]));
  const r = await runCheck(h.deps(store));
  assert.deepEqual(r.alerts, []);
  assert.equal(h.sent.filter((s) => s.chat === '111').length, 0);
  assert.equal(h.sent.filter((s) => s.chat === 'admin').length, 1, 'admin recebe 1 aviso');
});

await test('Fonte em baixo não parte as outras e conta falhas', async () => {
  const store = memoryStore();
  const h = harness({
    'https://bilhetes.fcporto.pt/': new Error('HTTP 503'),
    'https://www.fcporto.pt/pt': page([]),
    'https://news/rss': rss([]),
  });
  const r = await runCheck(h.deps(store));
  assert.equal(r.sources.bilheteira.ok, false);
  assert.equal(r.sources.site.ok, true);
  assert.equal(store._dump().fails.bilheteira, 1);
});

await test('Twitter/X: desligado sem token; com token só lê posts novos e filtra bilhetes', async () => {
  const xSource = { id: 'x', name: 'Twitter/X oficial', type: 'x', handle: 'FCPorto', official: true, filter: 'ticket', requiresEnv: 'X_BEARER_TOKEN' };
  const realFetch = globalThis.fetch;
  const calls = [];
  let timeline = { data: [{ id: '100', text: 'Golo! 1-0 💪' }], meta: { newest_id: '100' } };
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    const body = String(url).includes('/users/by/username/') ? { data: { id: '42' } } : timeline;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const store = memoryStore();
    await store.addSubscriber('111');
    const h = harness({});
    const deps = () => ({ ...h.deps(store), sources: [xSource] });

    delete process.env.X_BEARER_TOKEN;
    let r = await runCheck(deps());
    assert.equal(r.sources.x, undefined, 'sem token a fonte não corre');
    assert.equal(calls.length, 0);

    process.env.X_BEARER_TOKEN = 'tok';
    await runCheck(deps()); // 1.ª leitura: silenciosa, marca o ponto de partida
    assert.equal(h.sent.length, 0);

    timeline = {
      data: [
        { id: '102', text: '🎟️ Bilhetes para o FC Porto-Benfica à venda amanhã às 10h00! https://t.co/abc' },
        { id: '101', text: 'Treino de hoje no Olival' },
      ],
      meta: { newest_id: '102' },
    };
    r = await runCheck(deps());
    assert.deepEqual(r.alerts, ['🎟️ Bilhetes para o FC Porto-Benfica à venda amanhã às 10h00!']);
    assert.ok(h.sent[0].html.includes('https://x.com/FCPorto/status/102'));
    assert.ok(calls.at(-1).includes('since_id=100'), 'pede só posts depois do último visto');
    assert.equal(calls.filter((c) => c.includes('/users/by/username/')).length, 1, 'ID da conta procurado só 1 vez');

    timeline = { meta: { result_count: 0 } };
    h.sent.length = 0;
    r = await runCheck(deps());
    assert.equal(h.sent.length, 0);
    assert.ok(calls.at(-1).includes('since_id=102'));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.X_BEARER_TOKEN;
  }
});

await test('Hora da venda: lê frases reais e não confunde com a hora do jogo', async () => {
  const { parseSaleTime } = await import('../lib/when.js');
  // NOW = segunda, 2/11/2026, 12:00 em Lisboa
  const iso = (t) => new Date(t.at).toISOString();
  let t = parseSaleTime('O FC Porto vai colocar à venda esta quarta-feira, a partir das 10 horas, os bilhetes para o jogo com o Gil Vicente, agendado para a próxima segunda-feira, às 20h15', NOW);
  assert.equal(t.status, 'scheduled'); assert.equal(iso(t), '2026-11-04T10:00:00.000Z');
  t = parseSaleTime('Os bilhetes para o clássico frente ao Benfica, marcado para 5 de outubro, vão estar à venda a partir desta sexta-feira, pelas 17h00.', NOW);
  assert.equal(iso(t), '2026-11-06T17:00:00.000Z');
  t = parseSaleTime('O FC Porto coloca hoje à venda, a partir das 15h00, os bilhetes para o jogo que se disputa às 18h00 de sábado', NOW);
  assert.equal(iso(t), '2026-11-02T15:00:00.000Z');
  t = parseSaleTime('🎟️ Bilhetes à venda amanhã às 10h00!', NOW);
  assert.equal(iso(t), '2026-11-03T10:00:00.000Z');
  assert.equal(parseSaleTime('Bilhetes já à venda para o jogo com o Alverca', NOW).status, 'now');
  assert.equal(parseSaleTime('Bilhetes à venda a partir das 11h00', NOW).status, 'now', '11h já passou hoje');
  t = parseSaleTime('Bilhetes para o Sporting à venda sexta-feira', NOW);
  assert.equal(t.status, 'scheduled'); assert.equal(t.hasTime, false);
  // Hora de verão: 10h00 de 1 de julho em Lisboa = 09:00 UTC
  t = parseSaleTime('Bilhetes à venda 01/07/2027 às 10:00', NOW);
  assert.equal(iso(t), '2027-07-01T09:00:00.000Z');
});

await test('Anúncio antecipado: avisa com a hora e lembra 30 min antes e na abertura', async () => {
  const store = memoryStore();
  await store.addSubscriber('111');
  const h = harness({
    'https://bilhetes.fcporto.pt/': page([]),
    'https://www.fcporto.pt/pt': page([]),
    'https://news/rss': rss([]),
  });
  await runCheck(h.deps(store)); // 1.ª leitura

  h.pages['https://news/rss'] = rss([{ t: 'FC Porto: bilhetes para o clássico com o Benfica à venda amanhã a partir das 10h00', o: 'A Bola', l: 'https://n/b1' }]);
  let r = await runCheck(h.deps(store));
  assert.equal(r.timings[0].status, 'scheduled');
  assert.ok(h.sent[0].html.includes('A venda abre amanhã') || h.sent[0].html.includes('A venda abre'), h.sent[0].html);
  assert.ok(h.sent[0].html.includes('10h00'));

  // Outro jornal com a mesma notícia → não repete o aviso nem o lembrete.
  h.pages['https://news/rss'] = rss([
    { t: 'FC Porto: bilhetes para o clássico com o Benfica à venda amanhã a partir das 10h00', o: 'A Bola', l: 'https://n/b1' },
    { t: 'Bilhetes para o clássico com o Benfica à venda amanhã', o: 'Record', l: 'https://n/b2' },
  ]);
  h.sent.length = 0;
  await runCheck(h.deps(store));
  assert.equal(h.sent.length, 0);

  const at = (iso) => ({ ...h.deps(store), now: Date.parse(iso) });
  // Terça 09:20 → ainda nada
  await runCheck(at('2026-11-03T09:20:00Z'));
  assert.equal(h.sent.length, 0);
  // Terça 09:30 → lembrete "faltam 30 min"
  r = await runCheck(at('2026-11-03T09:30:30Z'));
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0].html.includes('Faltam 30 min'));
  // Terça 10:00 → "abriu agora"
  r = await runCheck(at('2026-11-03T10:01:00Z'));
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent[1].html.includes('ABRIU'));
  // Não repete
  await runCheck(at('2026-11-03T10:05:00Z'));
  assert.equal(h.sent.length, 2);
});

await test('Drop: jogo novo na bilheteira = JÁ À VENDA, sem lembretes', async () => {
  const store = memoryStore();
  await store.addSubscriber('111');
  const h = harness({
    'https://bilhetes.fcporto.pt/': page([]),
    'https://www.fcporto.pt/pt': page([]),
    'https://news/rss': rss([]),
    'https://bilhetes.fcporto.pt/evento/9': '<html><h1>FC Porto x Famalicão</h1><p>Comprar</p></html>',
  });
  await runCheck(h.deps(store));
  h.pages['https://bilhetes.fcporto.pt/'] = page([['/evento/9', 'FC Porto x Famalicão']]);
  const r = await runCheck(h.deps(store));
  assert.equal(r.timings[0].status, 'now');
  assert.ok(h.sent[0].html.includes('JÁ À VENDA'));
  assert.equal(store._dump().reminders.length, 0);
});

await test('Notícia do site sem hora no título: lê a hora no corpo da notícia', async () => {
  const store = memoryStore();
  await store.addSubscriber('111');
  const h = harness({
    'https://bilhetes.fcporto.pt/': page([]),
    'https://www.fcporto.pt/pt': page([]),
    'https://news/rss': rss([]),
    'https://www.fcporto.pt/pt/noticias/venda-braga': `<html><nav><a>Bilhetes</a></nav><h1>Venda de bilhetes para o SC Braga-FC Porto</h1>
      <p>Os bilhetes para o jogo em Braga, marcado para domingo às 20h30, ficam disponíveis na quinta-feira, a partir das 15h00, exclusivamente em bilhetes.fcporto.pt.</p></html>`,
  });
  await runCheck(h.deps(store));
  h.pages['https://www.fcporto.pt/pt'] = page([['/pt/noticias/venda-braga', 'Venda de bilhetes para o SC Braga-FC Porto']]);
  const r = await runCheck(h.deps(store));
  assert.equal(r.timings[0].status, 'scheduled');
  assert.equal(r.timings[0].at, '2026-11-05T15:00:00.000Z');
  assert.equal(store._dump().reminders.length, 2);
});

console.log(`\n${passed} testes passaram`);
