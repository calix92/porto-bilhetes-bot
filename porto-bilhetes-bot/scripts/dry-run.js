// npm run dry-run → lê as fontes a partir do teu PC e mostra o que o bot apanharia.
// Não precisa de Telegram nem de base de dados; não envia nada.
import { SOURCES } from '../lib/config.js';
import { readSource } from '../lib/sources.js';
import { fetchText } from '../lib/fetch.js';
import { memoryStore } from '../lib/store.js';

const store = memoryStore();

for (const src of SOURCES) {
  if (src.requiresEnv && !process.env[src.requiresEnv]) {
    console.log(`\n=== ${src.name} ===\n  (desativada: define ${src.requiresEnv} para testar)`);
    continue;
  }
  console.log(`\n=== ${src.name} ===`);
  try {
    const items = await readSource(src, (u) => fetchText(u, { timeoutMs: 15000 }), Date.now(), store);
    if (!items.length) console.log('  (nada relevante neste momento)');
    for (const it of items.slice(0, 15)) {
      console.log(`  • ${it.title.slice(0, 100)}${it.extra ? `  [${it.extra}]` : ''}\n    ${it.url}`);
    }
    if (items.length > 15) console.log(`  ... e mais ${items.length - 15}`);
  } catch (err) {
    console.log(`  ❌ erro: ${err.message}`);
  }
}
