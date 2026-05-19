import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Tier = "hot" | "mid" | "low";
type ProductRow = {
  _id: string;
  shopId: number;
  itemId: number;
  trackPriority: Tier;
  _scheduleHash: number;
  cooldownUntil?: Date;
};

const state = vi.hoisted(() => ({
  products: [] as ProductRow[],
  countOverrides: {} as Partial<Record<Tier, number>>,
  health: { success: 100, error429: 0, error5xx: 0, error4xx: 0, timeout: 0, errors: 0, errorRate5m: 0 },
}));

vi.mock("../shopee-api-health", () => ({
  computeApiHealth: vi.fn(async () => state.health),
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name !== "products") throw new Error(`unexpected collection ${name}`);
        return {
          countDocuments: async (filter: any) =>
            state.countOverrides[filter.trackPriority as Tier] ??
            state.products.filter((p) => matchesProductFilter(p, filter)).length,
          find: (filter: any) => ({
            limit: (n: number) =>
              asyncIterable(state.products.filter((p) => matchesProductFilter(p, filter)).slice(0, n)),
          }),
        };
      },
    }),
  },
}));

function matchesProductFilter(product: ProductRow, filter: any): boolean {
  if (filter.trackPriority && product.trackPriority !== filter.trackPriority) return false;
  if (filter._scheduleHash?.$mod) {
    const [divisor, remainder] = filter._scheduleHash.$mod;
    if (product._scheduleHash % divisor !== remainder) return false;
  }
  if (filter.$or) {
    const allowed = filter.$or.some((condition: any) => {
      if (condition.cooldownUntil?.$exists === false) return product.cooldownUntil === undefined;
      if (condition.cooldownUntil?.$lte)
        return Boolean(product.cooldownUntil && product.cooldownUntil <= condition.cooldownUntil.$lte);
      return false;
    });
    if (!allowed) return false;
  }
  return true;
}

function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function seedTier(tier: Tier, count: number, slot: number): ProductRow[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `${tier}-${i}`,
    shopId: i + 1,
    itemId: i + 10_000,
    trackPriority: tier,
    _scheduleHash: slot,
  }));
}

describe("FR-WORKER-002 — adaptive scheduler", () => {
  const oldEnv = { ...process.env };
  const fixedNow = new Date("2026-05-18T00:00:00.000Z");
  const minute = Math.floor(fixedNow.getTime() / 60_000);
  const queue = {
    add: vi.fn(async (_name: string, _data: Record<string, unknown>, _options: Record<string, unknown>) => undefined),
    getJobCounts: vi.fn(async (..._states: string[]) => ({
      waiting: 3,
      delayed: 2,
      active: 1,
      completed: 12,
      failed: 2,
    })),
  };
  const posthog = { capture: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    process.env = { ...oldEnv, MONGODB_URI: "mongodb://unit.test/salenoti" };
    state.health = { success: 100, error429: 0, error5xx: 0, error4xx: 0, timeout: 0, errors: 0, errorRate5m: 0 };
    state.countOverrides = {};
    state.products = [
      ...seedTier("hot", 100, minute % 30),
      ...seedTier("mid", 1000, minute % 360),
      ...seedTier("low", 10000, minute % 1440),
    ];
    queue.add.mockClear();
    queue.getJobCounts.mockClear();
    posthog.capture.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...oldEnv };
  });

  it("AC1: distributes 100 hot, 1000 mid, and 10000 low products across one minute", async () => {
    const { AdaptiveSchedulerService } = await import("../adaptive-scheduler.service");
    await new AdaptiveSchedulerService(queue as any, posthog).enqueueByTier();

    expect(queue.add).toHaveBeenCalledTimes(14);
    expect(queue.add.mock.calls.filter(([name]) => name === "pc-hot")).toHaveLength(4);
    expect(queue.add.mock.calls.filter(([name]) => name === "pc-mid")).toHaveLength(3);
    expect(queue.add.mock.calls.filter(([name]) => name === "pc-low")).toHaveLength(7);
    expect(queue.add.mock.calls[0]?.[2]).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000, jitter: 0.25 },
    });
  });

  it("AC5/AC9: scales enqueue volume by half and emits full tier health metrics on >5% health errors", async () => {
    state.health = { success: 94, error429: 6, error5xx: 0, error4xx: 0, timeout: 0, errors: 6, errorRate5m: 0.06 };
    const { AdaptiveSchedulerService } = await import("../adaptive-scheduler.service");
    await new AdaptiveSchedulerService(queue as any, posthog).enqueueByTier();

    expect(queue.add).toHaveBeenCalledTimes(8);
    expect(posthog.capture).toHaveBeenCalledWith(
      "scheduler_tier_health",
      expect.objectContaining({
        tier: "hot",
        scheduled: 2,
        succeeded: 12,
        failed: 2,
        current_depth: 6,
        errorRate5m: 0.06,
      }),
    );
  });

  it("skips products still cooling down after repeated Shopee failures", async () => {
    state.products = [
      {
        _id: "hot-cooling",
        shopId: 1,
        itemId: 2,
        trackPriority: "hot",
        _scheduleHash: minute % 30,
        cooldownUntil: new Date("2026-05-18T00:30:00.000Z"),
      },
      { _id: "hot-ready", shopId: 2, itemId: 3, trackPriority: "hot", _scheduleHash: minute % 30 },
    ];
    const { AdaptiveSchedulerService } = await import("../adaptive-scheduler.service");
    await new AdaptiveSchedulerService(queue as any, posthog).enqueueByTier();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0]?.[1]).toMatchObject({ shopId: 2, itemId: 3, tier: "hot" });
  });

  it("gracefully no-ops when Mongo is not configured in local development", async () => {
    delete process.env.MONGODB_URI;
    const { AdaptiveSchedulerService } = await import("../adaptive-scheduler.service");
    await new AdaptiveSchedulerService(queue as any, posthog).enqueueByTier();

    expect(queue.getJobCounts).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("falls back to zero queue depth when BullMQ counts are unavailable", async () => {
    queue.getJobCounts.mockRejectedValueOnce(new Error("redis unavailable"));
    state.products = [seedTier("hot", 1, minute % 30)[0]!];
    const { AdaptiveSchedulerService } = await import("../adaptive-scheduler.service");
    await new AdaptiveSchedulerService(queue as any, posthog).enqueueByTier();

    expect(posthog.capture).toHaveBeenCalledWith(
      "scheduler_tier_health",
      expect.objectContaining({ tier: "hot", current_depth: 0, succeeded: 0, failed: 0 }),
    );
  });

  it("normalizes partially populated BullMQ count payloads", async () => {
    queue.getJobCounts.mockResolvedValueOnce({ waiting: 4 } as any);
    state.products = [seedTier("hot", 1, minute % 30)[0]!];
    const { AdaptiveSchedulerService } = await import("../adaptive-scheduler.service");
    await new AdaptiveSchedulerService(queue as any, posthog).enqueueByTier();

    expect(posthog.capture).toHaveBeenCalledWith(
      "scheduler_tier_health",
      expect.objectContaining({ tier: "hot", current_depth: 4, succeeded: 0, failed: 0 }),
    );
  });

  it("caps hot-tier enqueue volume to the 50K-product budget during mega-sale surges", async () => {
    state.countOverrides = { hot: 100_000, mid: 0, low: 0 };
    state.products = seedTier("hot", 2_000, minute % 30);
    const { AdaptiveSchedulerService } = await import("../adaptive-scheduler.service");
    await new AdaptiveSchedulerService(queue as any, posthog).enqueueByTier();

    expect(queue.add).toHaveBeenCalledTimes(Math.ceil(50_000 / 30));
  });
});
