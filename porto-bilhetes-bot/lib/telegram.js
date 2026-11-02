const api = (method) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export function escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function callTelegram(method, payload) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Falta TELEGRAM_BOT_TOKEN');
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

// Envia uma mensagem. Devolve 'ok', 'blocked' (utilizador bloqueou o bot) ou 'error'.
export async function sendMessage(chatId, html, { preview = true } = {}) {
  const r = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: !preview },
  });
  if (r.ok) return 'ok';
  if (r.status === 403 || /chat not found|blocked|deactivated/i.test(r.description || '')) return 'blocked';
  console.error('Telegram erro', chatId, r.status, r.description);
  return 'error';
}
