// ─────────────────────────────────────────────────────────────
//  Configuração do bot — é aqui que mexes para personalizar.
// ─────────────────────────────────────────────────────────────

// Link para onde o bot manda as pessoas comprarem.
export const BUY_URL = 'https://bilhetes.fcporto.pt';

// Pesquisa no Google News (apanha A Bola, Record, O Jogo, Maisfutebol...,
// que costumam publicar poucos minutos depois do anúncio do clube).
const NEWS_QUERY = '("FC Porto" OR dragões OR portistas) (bilhetes OR ingressos) when:2d';

const googleNews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-PT&gl=PT&ceid=PT:pt-150`;

// Fontes vigiadas.
//  type 'links' → lê uma página e deteta links novos
//  type 'rss'   → lê um feed RSS e deteta notícias novas
//  official     → fontes oficiais avisam sempre (não são filtradas como duplicadas)
//  filter       → 'none' (todos os links novos), 'ticket' (texto fala de bilhetes),
//                 'ticket+sale' (fala de bilhetes E de venda/disponibilidade)
export const SOURCES = [
  {
    // Twitter/X oficial do clube. Só fica ativo se puseres X_BEARER_TOKEN no Vercel.
    id: 'x',
    name: 'Twitter/X oficial',
    type: 'x',
    handle: 'FCPorto',
    official: true,
    filter: 'ticket',
    requiresEnv: 'X_BEARER_TOKEN',
  },
  {
    id: 'bilheteira',
    name: 'Bilheteira oficial (bilhetes.fcporto.pt)',
    type: 'links',
    url: 'https://bilhetes.fcporto.pt/',
    official: true,
    filter: 'none',
  },
  {
    id: 'site',
    name: 'Site oficial (fcporto.pt)',
    type: 'links',
    url: 'https://www.fcporto.pt/pt',
    official: true,
    filter: 'ticket',
  },
  {
    id: 'noticias',
    name: 'Notícias',
    type: 'rss',
    url: googleNews(NEWS_QUERY),
    official: false,
    filter: 'ticket+sale',
    maxAgeHours: 36,
  },
];

// Palavras (sem acentos, minúsculas) que indicam bilhetes.
export const TICKET_WORDS = /\b(bilhetes?|ingressos?|bilheteira|tranche|lugar(es)? anua(l|is))\b|🎟|🎫/u;

// Palavras que indicam venda / abertura / disponibilidade.
export const SALE_WORDS = /(venda|vende|disponive|disponibiliz|tranche|comprar|adquirir|abre|arranca|alargad|socios)/;

// Notícias sobre bilhetes que NÃO interessam (polícia, fraudes, etc.).
export const NEGATIVE_WORDS = /(ilegal|apreend|buscas|arguid|detid|fraude|esquema|falsos|candong|reclama|multa|castig|investigac|tribunal)/;

// Links da bilheteira que são menus fixos e nunca interessam.
export const IGNORED_PATHS = /(login|logout|entrar|registo|register|signup|conta|account|perfil|profile|faq|ajuda|help|termos|terms|privacidade|privacy|cookies|carrinho|cart|checkout|contact|password|recuperar)/i;

// Se uma fonte oficial "ganhar" mais do que isto de links novos de uma vez,
// é quase certo que o site mudou de layout — o bot não faz spam, só avisa o admin.
export const MAX_NEW_PER_RUN = 6;

// Notícias com títulos parecidos dentro desta janela contam como a mesma.
export const DEDUPE_WINDOW_HOURS = 48;

// Avisar o admin quando uma fonte falhar este número de vezes seguidas.
export const FAIL_ALERT_AFTER = 30;

// Quantos minutos antes da abertura da venda chega o lembrete.
export const REMIND_BEFORE_MIN = 30;

// Quanto tempo o bot se lembra de um link que já viu.
export const SEEN_TTL_DAYS = 45;
