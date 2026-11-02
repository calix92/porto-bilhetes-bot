// Webhook do Telegram: recebe as mensagens que as pessoas mandam ao bot.
import { redisStore } from '../lib/store.js';
import { sendMessage, escapeHtml } from '../lib/telegram.js';
import { formatAlert, upcomingSales } from '../lib/check.js';
import { formatWhen } from '../lib/when.js';
import { SOURCES, BUY_URL } from '../lib/config.js';
import { activeSources } from '../lib/sources.js';

const HELP = [
  '<b>Comandos</b>',
  '/start — ativar os avisos',
  '/parar — deixar de receber avisos',
  '/vendas — próximas aberturas de venda já anunciadas',
  '/estado — ver se as fontes estão a funcionar',
  '/teste — receber um aviso de exemplo',
  '/ajuda — esta mensagem',
].join('\n');

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'medium' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).send('não autorizado');
  }

  const msg = req.body?.message;
  const text = (msg?.text || '').trim();
  const chatId = msg?.chat?.id;
  if (!chatId || !text.startsWith('/')) return res.status(200).send('ok');

  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const store = redisStore();

  try {
    switch (cmd) {
      case '/start': {
        const allowed = (process.env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (allowed.length && !allowed.includes(String(chatId))) {
          await sendMessage(chatId, `Este bot é privado. O teu chat ID é <code>${chatId}</code> — pede para te adicionarem.`);
          break;
        }
        const isNew = await store.addSubscriber(chatId);
        await sendMessage(
          chatId,
          (isNew ? '✅ <b>Avisos ativados!</b>' : '✅ Já estavas inscrito.') +
            `\n\nVou avisar-te mal o FC Porto ponha bilhetes à venda. 🔵⚪\n\nO teu chat ID: <code>${chatId}</code>\n\n${HELP}`,
          { preview: false }
        );
        break;
      }
      case '/parar':
      case '/stop': {
        await store.removeSubscriber(chatId);
        await sendMessage(chatId, '🔕 Avisos desativados. Manda /start para voltar a ativar.');
        break;
      }
      case '/estado': {
        const status = await store.getStatus();
        const subs = await store.getSubscribers();
        const lines = ['<b>Estado das fontes</b>', ''];
        for (const s of activeSources(SOURCES)) {
          const st = status[s.id];
          if (!st) lines.push(`⏳ ${escapeHtml(s.name)} — ainda não verificada`);
          else if (st.ok) lines.push(`✅ ${escapeHtml(s.name)} — ${fmtTime(st.at)} (${st.count} itens)`);
          else lines.push(`❌ ${escapeHtml(s.name)} — ${escapeHtml(st.error)} (${st.fails}x)`);
        }
        lines.push('', `Inscritos: ${subs.length}`, subs.includes(String(chatId)) ? 'Tu: ✅ inscrito' : 'Tu: ❌ não inscrito (/start)');
        await sendMessage(chatId, lines.join('\n'), { preview: false });
        break;
      }
      case '/vendas': {
        const list = await upcomingSales(store);
        const text = list.length
          ? '<b>Próximas aberturas de venda</b>\n\n' +
            list.map((r) => `📅 <b>${formatWhen(r.saleAt, r.kind === 'open')}</b>\n${escapeHtml(r.title)}`).join('\n\n')
          : 'Não há nenhuma abertura de venda anunciada para os próximos dias.\nQuando houver, aviso-te. 😉';
        await sendMessage(chatId, text, { preview: false });
        break;
      }
      case '/teste': {
        await sendMessage(
          chatId,
          formatAlert({
            title: 'EXEMPLO — Bilhetes para o FC Porto-Benfica à venda a partir das 10h00',
            url: BUY_URL,
            sourceName: 'Teste',
            extra: '',
          })
        );
        break;
      }
      default:
        await sendMessage(chatId, HELP);
    }
  } catch (err) {
    console.error(err);
  }
  // Responder sempre 200, senão o Telegram repete a mensagem.
  res.status(200).send('ok');
}
