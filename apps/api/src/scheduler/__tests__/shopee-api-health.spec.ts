import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  hashes: new Map<string, Record<string, string>>(),
  hincrby: vi.fn(async (key: string, field: string, amount: number) => {
    const hash = redisState.hashes.get(key) ?? {};
    hash[field] = String(Number(hash[field] ?? 0) + amount);
    redisState.hashes.set(key, hash);
  }),
  expire: vi.fn(async (_key: string, _ttl: number) => 1),
  hgetall: vi.fn(async (key: string) => redisState.hashes.get(key) ?? {}),
}));

vi.mock("../../queue/redis.client", () => ({
  redis: {
    hincrby: redisState.hincrby,
    expire: redisState.expire,
    hgetall: redisState.hgetall,
  },
}));

describe("FR-WORKER-002 — Shopee API rolling health window", () => {
  const fixedNow = new Date("2026-05-18T00:07:00.000Z");
  const currentBucket = "shopee:api:health:5m:5930209";
  const previousBucket = "shopee:api:health:5m:5930208";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    redisState.hashes.clear();
    redisState.hincrby.mockClear();
    redisState.expire.mockClear();
    redisState.hgetall.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records exact outcome fields with a 10-minute expiry", async () => {
    const { recordApiOutcome } = await import("../shopee-api-health");

    await recordApiOutcome("error_429");
    await recordApiOutcome("success");

    expect(redisState.hincrby).toHaveBeenNthCalledWith(1, currentBucket, "error_429", 1);
    expect(redisState.hincrby).toHaveBeenNthCalledWith(2, currentBucket, "success", 1);
    expect(redisState.expire).toHaveBeenCalledWith(currentBucket, 600);
  });

  it("sums current and previous buckets and excludes 4xx from throttleable errors", async () => {
    redisState.hashes.set(currentBucket, {
      success: "94",
      error_429: "3",
      error_5xx: "2",
      timeout: "1",
      error_4xx: "10",
    });
    redisState.hashes.set(previousBucket, {
      success: "100",
      error_429: "1",
      error_5xx: "0",
      timeout: "0",
      error_4xx: "4",
    });
    const { computeApiHealth } = await import("../shopee-api-health");

    await expect(computeApiHealth()).resolves.toEqual({
      success: 194,
      error429: 4,
      error5xx: 2,
      error4xx: 14,
      timeout: 1,
      errors: 7,
      errorRate5m: 7 / 215,
    });
  });

  it("returns a zero error rate when Redis has no samples", async () => {
    const { computeApiHealth } = await import("../shopee-api-health");

    await expect(computeApiHealth()).resolves.toMatchObject({ success: 0, errors: 0, errorRate5m: 0 });
  });
});
