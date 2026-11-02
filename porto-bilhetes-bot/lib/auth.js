// Só aceita pedidos com a chave secreta (no cabeçalho ou em ?key=).
export function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization || '';
  return header === `Bearer ${secret}` || req.query?.key === secret;
}
