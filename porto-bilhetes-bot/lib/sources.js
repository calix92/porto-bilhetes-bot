import { parseRss, parseLinks, passesFilter } from './parse.js';
import { readX } from './x.js';

// Lê uma fonte e devolve os itens relevantes: [{ key, url, title, extra }]
export async function readSource(source, fetcher, now = Date.now(), store = null) {
  if (source.type === 'x') {
    const posts = await readX(source, store);
    return posts
      .filter((p) => passesFilter({ url: p.url, title: p.text }, source.filter))
      .map((p) => ({
        key: p.url,
        url: p.url,
        title: p.text.length > 280 ? `${p.text.slice(0, 277)}…` : p.text,
        extra: `@${source.handle}`,
      }));
  }

  const body = await fetcher(source.url);

  if (source.type === 'rss') {
    const maxAge = (source.maxAgeHours ?? 48) * 3600_000;
    return parseRss(body)
      .filter((it) => !it.publishedAt || now - it.publishedAt <= maxAge)
      .filter((it) => passesFilter(it, source.filter))
      .map((it) => ({ key: it.url, url: it.url, title: it.title, extra: it.outlet || '' }));
  }

  if (source.type === 'links') {
    return parseLinks(body, source.url, { sameHost: true })
      .filter((it) => passesFilter(it, source.filter))
      .map((it) => ({ key: it.url, url: it.url, title: it.title || it.url, extra: '' }));
  }

  throw new Error(`tipo de fonte desconhecido: ${source.type}`);
}

// Fontes que precisam de uma chave só ficam ativas se a chave existir.
export function activeSources(sources) {
  return sources.filter((s) => !s.requiresEnv || process.env[s.requiresEnv]);
}
