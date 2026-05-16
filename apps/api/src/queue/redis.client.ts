// FR-WORKER-001 — single shared ioredis client.
import Redis from "ioredis";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL not set; configure Doppler.");
  _redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
  return _redis;
}

export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const r = getRedis();
    const value = (r as any)[prop];
    return typeof value === "function" ? value.bind(r) : value;
  },
});
