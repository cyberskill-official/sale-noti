import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_OPTIONS,
  PRICE_CHECK_JOB_OPTIONS,
  QUEUE_CONCURRENCY,
  bullConnectionFromUrl,
  priceCheckWorkerOptions,
} from "../queues";

const OLD_ENV = { ...process.env };

describe("FR-WORKER-001/002 — queue metadata", () => {
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("parses rediss Upstash URLs with BullMQ-safe options", () => {
    const connection = bullConnectionFromUrl("rediss://default:secret@example.upstash.io:6380");

    expect(connection.host).toBe("example.upstash.io");
    expect(connection.port).toBe(6380);
    expect(connection.password).toBe("secret");
    expect(connection.tls).toEqual({});
    expect(connection.maxRetriesPerRequest).toBeNull();
    expect(connection.enableReadyCheck).toBe(false);
  });

  it("parses plain Redis URLs with default port and no TLS/password", () => {
    const connection = bullConnectionFromUrl("redis://localhost");

    expect(connection.host).toBe("localhost");
    expect(connection.port).toBe(6379);
    expect(connection.password).toBeUndefined();
    expect(connection.tls).toBeUndefined();
  });

  it("keeps bounded default retention and retry policy", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: "exponential", delay: 30_000 });
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ count: 1000, age: 86_400 });
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({ count: 5000, age: 604_800 });
  });

  it("caps price-check worker throughput at the configured Shopee budget", () => {
    process.env.SHOPEE_RATE_LIMIT_PER_MIN = "17";

    expect(QUEUE_CONCURRENCY["price-check"]).toBe(5);
    expect(PRICE_CHECK_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000, jitter: 0.25 },
    });
    expect(priceCheckWorkerOptions()).toMatchObject({
      concurrency: 5,
      limiter: { max: 17, duration: 60_000 },
    });
  });

  it("uses the default 1000/min Shopee budget when unset", () => {
    delete process.env.SHOPEE_RATE_LIMIT_PER_MIN;

    expect(priceCheckWorkerOptions()).toMatchObject({
      concurrency: 5,
      limiter: { max: 1000, duration: 60_000 },
    });
  });
});
