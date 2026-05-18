// FR-WORKER-002 §3 — rolling 5-min Shopee API health metric.
import { redis } from "../queue/redis.client";

export type ApiOutcome = "success" | "error_429" | "error_5xx" | "error_4xx" | "timeout";
export type ShopeeApiHealth = {
  success: number;
  error429: number;
  error5xx: number;
  error4xx: number;
  timeout: number;
  errors: number;
  errorRate5m: number;
};

function bucketKey(): string {
  return `shopee:api:health:5m:${Math.floor(Date.now() / 300_000)}`;
}

export async function recordApiOutcome(outcome: ApiOutcome): Promise<void> {
  const key = bucketKey();
  await redis.hincrby(key, outcome, 1);
  await redis.expire(key, 600);
}

export async function computeApiHealth(): Promise<ShopeeApiHealth> {
  // Sum the last two 5-min buckets to smooth over edge.
  const buckets = [bucketKey(), `shopee:api:health:5m:${Math.floor(Date.now() / 300_000) - 1}`];
  let success = 0;
  let error429 = 0;
  let error5xx = 0;
  let error4xx = 0;
  let timeout = 0;
  for (const k of buckets) {
    const h = (await redis.hgetall(k)) as Record<string, string>;
    success += Number(h.success ?? 0);
    error429 += Number(h.error_429 ?? 0);
    error5xx += Number(h.error_5xx ?? 0);
    error4xx += Number(h.error_4xx ?? 0);
    timeout += Number(h.timeout ?? 0);
  }
  const errors = error429 + error5xx + timeout;
  const total = success + errors + error4xx;
  return { success, error429, error5xx, error4xx, timeout, errors, errorRate5m: total === 0 ? 0 : errors / total };
}
