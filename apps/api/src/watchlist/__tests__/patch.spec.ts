import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertConfigSchema } from "../alert-config.zod";
import { WatchlistCrudController } from "../watchlist-crud.controller";

const state = vi.hoisted(() => ({
  redis: {
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock("../../queue/redis.client", () => ({
  redis: state.redis,
}));

describe("FR-WATCH-002 — AlertConfigSchema", () => {
  it("accepts the four closed trigger kinds and applies defaults", () => {
    const parsed = AlertConfigSchema.parse({
      triggers: [
        { kind: "absolute_drop", targetPrice: 50_000 },
        { kind: "pct_drop", minDropPct: 15 },
        { kind: "lowest_30d" },
        { kind: "flash_sale" },
      ],
    });

    expect(parsed.triggers).toEqual([
      { kind: "absolute_drop", targetPrice: 50_000, paused: false },
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: false },
      { kind: "lowest_30d", paused: false },
      { kind: "flash_sale", minDiscountPct: 30, paused: false },
    ]);
  });

  it("rejects duplicate kinds, unknown fields, unknown kinds, and out-of-range values", () => {
    expect(() =>
      AlertConfigSchema.parse({
        triggers: [
          { kind: "pct_drop", minDropPct: 10 },
          { kind: "pct_drop", minDropPct: 20 },
        ],
      }),
    ).toThrow("duplicate_trigger_kind");
    expect(() => AlertConfigSchema.parse({ triggers: [{ kind: "pct_drop", minDropPct: 0 }] })).toThrow();
    expect(() => AlertConfigSchema.parse({ triggers: [{ kind: "pct_drop", minDropPct: 91 }] })).toThrow();
    expect(() => AlertConfigSchema.parse({ triggers: [{ kind: "absolute_drop", targetPrice: -1 }] })).toThrow();
    expect(() =>
      AlertConfigSchema.parse({ triggers: [{ kind: "absolute_drop", targetPrice: 1_500_000_000 }] }),
    ).toThrow();
    expect(() => AlertConfigSchema.parse({ triggers: [{ kind: "flash_sale", minDiscountPct: 9 }] })).toThrow();
    expect(() => AlertConfigSchema.parse({ triggers: [{ kind: "flash_sale", minDiscountPct: 91 }] })).toThrow();
    expect(() => AlertConfigSchema.parse({ triggers: [{ kind: "new_kind" }] })).toThrow();
    expect(() =>
      AlertConfigSchema.parse({ triggers: [{ kind: "lowest_30d", paused: false }], triggerCooldowns: {} }),
    ).toThrow();
  });
});

describe("FR-WATCH-002 — WatchlistCrudController patch contract", () => {
  beforeEach(() => {
    state.redis.incr = vi.fn(async () => 1);
    state.redis.expire = vi.fn(async () => 1);
  });

  it("passes parsed patch bodies and source context into the service", async () => {
    const watch = { patch: vi.fn(async (input) => ({ ok: true, input })) };
    const controller = new WatchlistCrudController(watch as any);

    await controller.patch(
      "wl-1",
      { status: "paused", alertConfig: { triggers: [{ kind: "lowest_30d", paused: false }] } },
      "user-1",
      "ext",
    );

    expect(watch.patch).toHaveBeenCalledWith({
      userId: "user-1",
      watchlistId: "wl-1",
      status: "paused",
      alertConfig: { triggers: [{ kind: "lowest_30d", paused: false }] },
      source: "ext",
    });
  });

  it("rejects unauthenticated and unknown-field PATCH requests", async () => {
    const controller = new WatchlistCrudController({ patch: vi.fn() } as any);

    await expect(controller.patch("wl-1", { status: "paused" }, undefined, "web")).rejects.toMatchObject({
      response: { ok: false, error: "unauthenticated" },
      status: 401,
    });
    await expect(
      controller.patch("wl-1", { status: "paused", triggerCooldowns: {} }, "user-1", "web"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: "validation_failed" }),
      status: 400,
    });
  });

  it("covers list and delete auth guards for the shared controller", async () => {
    const watch = {
      list: vi.fn(async () => ({ items: [] })),
      softDelete: vi.fn(async () => ({ ok: true })),
    };
    const controller = new WatchlistCrudController(watch as any);

    await expect(controller.list({}, undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.list({ status: "all", page: "2", size: "100" }, "user-1")).resolves.toEqual({ items: [] });
    expect(state.redis.incr).toHaveBeenCalledWith(expect.stringContaining("rl:watch:user-1:"));
    expect(watch.list).toHaveBeenCalledWith({ userId: "user-1", status: "all", page: 2, size: 100 });
    await expect(controller.list({ status: "archived" }, "user-1")).rejects.toMatchObject({ status: 400 });
    await expect(controller.remove("wl-1", undefined, undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.remove("wl-1", "user-1", "ext")).resolves.toEqual({ ok: true });
    expect(watch.softDelete).toHaveBeenCalledWith({ userId: "user-1", watchlistId: "wl-1", source: "ext" });
  });

  it("rate-limits combined CRUD calls at 50/min/user", async () => {
    state.redis.incr.mockResolvedValueOnce(51);
    const response = { setHeader: vi.fn() };
    const controller = new WatchlistCrudController({ list: vi.fn() } as any);

    await expect(controller.list({}, "user-1", response as any)).rejects.toMatchObject({
      response: { ok: false, error: "rate_limit", retryAfter: 60 },
      status: 429,
    });
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "60");
  });
});
