import { SEEN_TTL_DAYS } from './config.js';

// Fala com o Upstash Redis pela API REST (sem bibliotecas).
// O Upstash ligado pelo Vercel pode criar KV_REST_API_* ou UPSTASH_REDIS_REST_*.
function client() {
     const pick = (re) => Object.entries(process.env).find(([k, v]) => re.test(k) && v)?.[1];
     const url = (pick(/^(UPSTASH_REDIS_REST_URL|(.+_)?KV_REST_API_URL)$/) || '').replace(/\/$/, '');
     const token = pick(/^(UPSTASH_REDIS_REST_TOKEN|(.+_)?KV_REST_API_TOKEN)$/);
  if (!url || !token) {
    throw new Error('Falta a base de dados: liga o Upstash Redis ao projeto no Vercel (Storage).');
  }
  return async (...command) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command.map(String)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Redis ${command[0]}: ${data.error || res.status}`);
    return data.result;
  };
}

const asObj = (v) => {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
};

export function redisStore() {
  const r = client();
  return {
    async getStatus() {
      const flat = (await r('HGETALL', 'status')) || [];
      const out = {};
      for (let i = 0; i < flat.length; i += 2) out[flat[i]] = asObj(flat[i + 1]);
      return out;
    },
    async setStatus(id, obj) {
      await r('HSET', 'status', id, JSON.stringify(obj));
    },
    async isInitialized(id) {
      return (await r('EXISTS', `init:${id}`)) === 1;
    },
    async markInitialized(id) {
      await r('SET', `init:${id}`, Date.now());
    },
    async getSeen(id) {
      return new Set(((await r('ZRANGE', `seen:${id}`, 0, -1)) || []).map(String));
    },
    async saveSeen(id, keys, now = Date.now()) {
      const k = `seen:${id}`;
      if (keys.length) await r('ZADD', k, ...keys.flatMap((m) => [now, m]));
      await r('ZREMRANGEBYSCORE', k, 0, now - SEEN_TTL_DAYS * 86400_000);
    },
    async getRecent() {
      return ((await r('LRANGE', 'recent', 0, 99)) || []).map(asObj).filter(Boolean);
    },
    async addRecent(entry) {
      await r('LPUSH', 'recent', JSON.stringify(entry));
      await r('LTRIM', 'recent', 0, 99);
    },
    async getSubscribers() {
      return ((await r('SMEMBERS', 'subs')) || []).map(String);
    },
    async addSubscriber(chatId) {
      return (await r('SADD', 'subs', chatId)) === 1;
    },
    async removeSubscriber(chatId) {
      return (await r('SREM', 'subs', chatId)) === 1;
    },
    async incrFail(id) {
      return r('INCR', `fail:${id}`);
    },
    async resetFail(id) {
      await r('DEL', `fail:${id}`);
    },
    async getValue(key) {
      return r('GET', key);
    },
    async setValue(key, value) {
      await r('SET', key, value);
    },
    // Lembretes: sorted set com a hora de envio como score. Um por tipo e hora.
    async addReminder(at, data) {
      const same = ((await r('ZRANGEBYSCORE', 'reminders', at, at)) || []).map(asObj);
      if (same.some((x) => x && x.kind === data.kind)) return false;
      await r('ZADD', 'reminders', at, JSON.stringify({ ...data, at }));
      return true;
    },
    async popDueReminders(now) {
      const due = ((await r('ZRANGEBYSCORE', 'reminders', '-inf', now)) || []).map(asObj).filter(Boolean);
      if (due.length) await r('ZREMRANGEBYSCORE', 'reminders', '-inf', now);
      return due;
    },
    async getUpcomingReminders(now) {
      return ((await r('ZRANGEBYSCORE', 'reminders', `(${now}`, '+inf')) || []).map(asObj).filter(Boolean);
    },
  };
}

// Versão em memória, usada nos testes e no dry-run.
export function memoryStore() {
  const status = {}, init = new Set(), seen = {}, fails = {}, kv = {};
  let reminders = [];
  const subs = new Set();
  let recent = [];
  return {
    _dump: () => ({ status, init, seen, recent, subs, fails, reminders }),
    async getStatus() { return { ...status }; },
    async setStatus(id, obj) { status[id] = obj; },
    async isInitialized(id) { return init.has(id); },
    async markInitialized(id) { init.add(id); },
    async getSeen(id) { return new Set(seen[id] || []); },
    async saveSeen(id, keys) { seen[id] = new Set([...(seen[id] || []), ...keys]); },
    async getRecent() { return [...recent]; },
    async addRecent(e) { recent = [e, ...recent].slice(0, 100); },
    async getSubscribers() { return [...subs]; },
    async addSubscriber(c) { const n = !subs.has(String(c)); subs.add(String(c)); return n; },
    async removeSubscriber(c) { return subs.delete(String(c)); },
    async incrFail(id) { fails[id] = (fails[id] || 0) + 1; return fails[id]; },
    async resetFail(id) { delete fails[id]; },
    async getValue(k) { return kv[k] ?? null; },
    async setValue(k, v) { kv[k] = String(v); },
    async addReminder(at, data) {
      if (reminders.some((x) => x.at === at && x.kind === data.kind)) return false;
      reminders.push({ ...data, at });
      return true;
    },
    async popDueReminders(now) {
      const due = reminders.filter((x) => x.at <= now).sort((a, b) => a.at - b.at);
      reminders = reminders.filter((x) => x.at > now);
      return due;
    },
    async getUpcomingReminders(now) { return reminders.filter((x) => x.at > now); },
  };
}
