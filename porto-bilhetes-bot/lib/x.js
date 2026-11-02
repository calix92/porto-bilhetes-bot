// Lê os posts novos de uma conta do X (Twitter) pela API oficial (pagamento por uso).
// Só pede os posts publicados depois do último que já viu (since_id),
// por isso só pagas pelos posts novos da conta.
import { decodeEntities } from './parse.js';

const API = 'https://api.x.com/2';

async function xGet(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error(`X: token inválido ou sem acesso (${res.status})`);
  if (res.status === 402) throw new Error('X: sem créditos na conta de developer');
  if (res.status === 429) throw new Error('X: limite de pedidos atingido');
  if (!res.ok) throw new Error(`X: HTTP ${res.status} ${data.title || data.detail || ''}`.trim());
  return data;
}

export async function readX(source, store) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error('falta X_BEARER_TOKEN');
  const handle = source.handle.replace(/^@/, '');

  // O ID numérico da conta só se procura uma vez.
  let userId = await store.getValue(`x:uid:${handle}`);
  if (!userId) {
    const u = await xGet(`/users/by/username/${encodeURIComponent(handle)}`, token);
    userId = u?.data?.id;
    if (!userId) throw new Error(`X: conta @${handle} não encontrada`);
    await store.setValue(`x:uid:${handle}`, userId);
  }

  const sinceId = await store.getValue(`x:since:${handle}`);
  const params = new URLSearchParams({
    max_results: sinceId ? '20' : '5', // na 1.ª vez só precisa do último post, para marcar o ponto de partida
    exclude: 'retweets,replies',
    'tweet.fields': 'created_at',
  });
  if (sinceId) params.set('since_id', String(sinceId));

  const data = await xGet(`/users/${userId}/tweets?${params}`, token);
  const posts = data?.data || [];
  if (data?.meta?.newest_id) await store.setValue(`x:since:${handle}`, data.meta.newest_id);

  return posts.map((p) => {
    const text = decodeEntities(p.text || '').replace(/https:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim();
    return {
      id: p.id,
      text,
      url: `https://x.com/${handle}/status/${p.id}`,
    };
  });
}
