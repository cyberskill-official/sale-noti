import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopeeRateLimitGuard } from "../rate-limit-guard";

const redisState = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  expireCalls: [] as Array<[string, number]>,
}));

vi.mock("../../../queue/redis.client", () => ({
  redis: {
    incr: vi.fn(async (key: string) => {
      const next = (redisState.counts.get(key) ?? 0) + 1;
      redisState.counts.set(key, next);
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      redisState.expireCalls.push([key, seconds]);
      return 1;
    }),
  },
}));

describe("FR-AFF-001 — ShopeeRateLimitGuard", () => {
  const oldEnv = { ...process.env };
  const fakeNow = new Date("2026-05-18T00:00:58.000Z");
  const firstMinute = Math.floor(fakeNow.getTime() / 60_000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);
    process.env = { ...oldEnv, SHOPEE_RATE_LIMIT_PER_MIN: "2" };
    redisState.counts.clear();
    redisState.expireCalls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...oldEnv };
    vi.restoreAllMocks();
  });

  it("waits into the next minute when the global bucket is exhausted", async () => {
    const guard = new ShopeeRateLimitGuard();

    await guard.acquire();
    await guard.acquire();
    const thirdAcquire = guard.acquire();

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(thirdAcquire).resolves.toBeUndefined();

    expect([...redisState.counts.entries()]).toEqual([
      [`shopee:rl:global:${firstMinute}`, 3],
      [`shopee:rl:global:${firstMinute + 1}`, 1],
    ]);
    expect(redisState.expireCalls).toEqual([
      [`shopee:rl:global:${firstMinute}`, 65],
      [`shopee:rl:global:${firstMinute + 1}`, 65],
    ]);
  });
});
