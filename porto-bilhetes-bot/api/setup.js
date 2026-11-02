// GET /api/setup?key=CRON_SECRET → liga o bot do Telegram a este projeto (corre-se 1 vez).
import { callTelegram } from '../lib/telegram.js';
import { authorized } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'não autorizado' });
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `https://${host}/api/telegram`;

    const webhook = await callTelegram('setWebhook', {
      url,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });

    const commands = await callTelegram('setMyCommands', {
      commands: [
        { command: 'start', description: 'Ativar os avisos de bilhetes' },
        { command: 'parar', description: 'Desativar os avisos' },
        { command: 'vendas', description: 'Próximas aberturas de venda anunciadas' },
        { command: 'estado', description: 'Ver se as fontes estão a funcionar' },
        { command: 'teste', description: 'Receber um aviso de exemplo' },
        { command: 'ajuda', description: 'Lista de comandos' },
      ],
    });

    const me = await callTelegram('getMe', {});

    res.status(200).json({
      ok: Boolean(webhook.ok && commands.ok),
      bot: me.result ? `@${me.result.username}` : null,
      webhookUrl: url,
      webhook: webhook.description,
      next: me.result ? `Abre https://t.me/${me.result.username} e manda /start` : 'Verifica o TELEGRAM_BOT_TOKEN',
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
