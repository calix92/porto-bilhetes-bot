import { TICKET_WORDS, SALE_WORDS, NEGATIVE_WORDS, IGNORED_PATHS } from './config.js';

// Minúsculas, sem acentos, espaços normalizados.
export function normalize(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Chave estável para um URL (sem #, sem utm_*, sem barra final).
export function urlKey(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|oc$)/i.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

// ── RSS ──────────────────────────────────────────────────────
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

export function parseRss(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const outlet = tag(block, 'source');
    let title = tag(block, 'title').replace(/<[^>]+>/g, '');
    // O Google News acrescenta " - A Bola" no fim do título.
    if (outlet && title.endsWith(` - ${outlet}`)) {
      title = title.slice(0, -(outlet.length + 3)).trim();
    }
    const link = tag(block, 'link');
    const pub = Date.parse(tag(block, 'pubDate'));
    if (!title || !link) continue;
    items.push({ title, url: link, outlet, publishedAt: Number.isNaN(pub) ? null : pub });
  }
  return items;
}

// ── Links numa página HTML ───────────────────────────────────
export function parseLinks(html, baseUrl, { sameHost = true } = {}) {
  const baseHost = new URL(baseUrl).hostname;
  const clean = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '');
  const out = new Map();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(clean))) {
    const attrs = m[1];
    const inner = m[2];
    const attr = (name) => {
      const r = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return r ? decodeEntities(r[1] ?? r[2] ?? r[3] ?? '').trim() : '';
    };
    const href = attr('href');
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (sameHost && abs.hostname !== baseHost) continue;

    let text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) text = attr('title') || attr('aria-label');
    if (!text) {
      const alt = inner.match(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      text = alt ? decodeEntities(alt[1] ?? alt[2]).trim() : '';
    }

    const key = urlKey(abs.toString());
    const prev = out.get(key);
    // Se o mesmo link aparece várias vezes, fica o texto mais completo.
    if (!prev || text.length > prev.title.length) out.set(key, { url: key, title: text });
  }
  return [...out.values()];
}

// ── Filtros ──────────────────────────────────────────────────
export function isNegative(text) {
  return NEGATIVE_WORDS.test(normalize(text));
}

export function passesFilter(item, filter) {
  const t = normalize(item.title);
  if (filter === 'none') {
    let path = '';
    try { path = new URL(item.url).pathname; } catch {}
    if (path === '/' || path === '') return false;
    return !IGNORED_PATHS.test(path) && !IGNORED_PATHS.test(t);
  }
  if (NEGATIVE_WORDS.test(t)) return false;
  if (!TICKET_WORDS.test(t)) return false;
  if (filter === 'ticket+sale') return SALE_WORDS.test(t);
  return true;
}

// ── Deduplicação de notícias com títulos parecidos ───────────
const STOPWORDS = new Set(
  ('a o as os de do da dos das e em no na nos nas para por com um uma ao aos se que ja ' +
   'esta este hoje amanha fc porto dragoes portistas bilhetes bilhete ingressos ingresso venda ' +
   'vendas jogo partida coloca colocou poe sao estao ficam fica disponiveis disponivel partir ' +
   'adeptos socios horas feira segunda terca quarta quinta sexta sabado domingo classico ' +
   'dia contra frente rececao recebe visita deslocacao estadio dragao comprar arranca abre')
    .split(' ')
);

export function signature(title) {
  return [...new Set(
    normalize(title)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(' ')
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+h?\d*$/.test(w))
  )];
}

export function similar(sigA, sigB) {
  if (!sigA.length || !sigB.length) return false;
  const b = new Set(sigB);
  const inter = sigA.filter((w) => b.has(w)).length;
  const union = new Set([...sigA, ...sigB]).size;
  return inter / union >= 0.5;
}
