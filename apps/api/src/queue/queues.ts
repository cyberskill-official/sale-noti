import type { JobsOptions } from "bullmq";

export const QUEUES = ["price-check", "alert-dispatch", "commission-reconcile", "housekeeping"] as const;
export type QueueName = (typeof QUEUES)[number];

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { count: 1000, age: 86_400 },
  removeOnFail: { count: 5000, age: 7 * 86_400 },
};

export const PRICE_CHECK_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000, jitter: 0.25 },
  removeOnComplete: { count: 1000, age: 86_400 },
  removeOnFail: { count: 5000, age: 7 * 86_400 },
};

export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  "price-check": 5,
  "alert-dispatch": 10,
  "commission-reconcile": 2,
  housekeeping: 1,
};

export function bullConnectionFromUrl(urlStr: string) {
  const url = new URL(urlStr);
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export function priceCheckWorkerOptions() {
  return {
    concurrency: QUEUE_CONCURRENCY["price-check"],
    limiter: {
      max: Number(process.env.SHOPEE_RATE_LIMIT_PER_MIN ?? 1000),
      duration: 60_000,
    },
  };
}
