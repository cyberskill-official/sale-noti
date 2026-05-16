// Minimal fixed-window rate limiter. Uses Redis if REDIS_URL present, otherwise in-process Map (dev only).
import { Redis } from "ioredis";

let _redis: Redis | null | undefined = undefined; // undefined = not init, null = dev/no-redis
function redis(): Redis | null {
  if (_redis !== undefined) return _redis;
  if (!process.env.REDIS_URL) return (_redis = null);
  _redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false });
  return _redis;
}

const memCounter = new Map<string, { count: number; expiresAt: number }>();

export async function rateLimitFixed(key: string, max: number, windowSec: number): Promise<{ ok: boolean; used: number }> {
  const r = redis();
  if (r) {
    const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
    const used = await r.incr(bucket);
    if (used === 1) await r.expire(bucket, windowSec);
    return { ok: used <= max, used };
  }
  // dev fallback
  const now = Date.now();
  for (const [k, v] of memCounter) if (v.expiresAt < now) memCounter.delete(k);
  const cur = memCounter.get(key);
  if (!cur || cur.expiresAt < now) {
    memCounter.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
    return { ok: true, used: 1 };
  }
  cur.count++;
  return { ok: cur.count <= max, used: cur.count };
}
