// GET /api/check?key=CRON_SECRET  → vê as fontes e avisa no Telegram.
// Chamado de 2 em 2 minutos pelo cron-job.org (e 1x por dia pelo cron do Vercel, como reserva).
import { runCheck } from '../lib/check.js';
import { redisStore } from '../lib/store.js';
import { fetchText } from '../lib/fetch.js';
import { sendMessage } from '../lib/telegram.js';
import { authorized } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'não autorizado' });
  try {
    const result = await runCheck({
      store: redisStore(),
      fetcher: (url) => fetchText(url),
      send: (chat, html) => sendMessage(chat, html),
      admin: process.env.ADMIN_CHAT_ID || null,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
}
