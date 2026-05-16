// FR-WORKER-002 §3 — rolling 5-min Shopee API health metric.
import { redis } from "../queue/redis.client";

export type ApiOutcome = "success" | "error_429" | "error_5xx" | "error_4xx" | "timeout";

function bucketKey(): string {
  return `shopee:api:health:5m:${Math.floor(Date.now() / 300_000)}`;
}

export async function recordApiOutcome(outcome: ApiOutcome): Promise<void> {
  const field = outcome === "success" ? "success" : "error";
  const key = bucketKey();
  await redis.hincrby(key, field, 1);
  await redis.expire(key, 600);
}

export async function computeApiHealth(): Promise<{ success: number; errors: number; errorRate5m: number }> {
  // Sum the last two 5-min buckets to smooth over edge.
  const buckets = [bucketKey(), `shopee:api:health:5m:${Math.floor(Date.now() / 300_000) - 1}`];
  let success = 0;
  let errors = 0;
  for (const k of buckets) {
    const h = (await redis.hgetall(k)) as Record<string, string>;
    success += Number(h.success ?? 0);
    errors += Number(h.error ?? 0);
  }
  const total = success + errors;
  return { success, errors, errorRate5m: total === 0 ? 0 : errors / total };
}
