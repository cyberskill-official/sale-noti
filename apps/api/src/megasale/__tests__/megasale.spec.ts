import { beforeEach, describe, expect, it, vi } from "vitest";
import { MegaSaleController } from "../megasale.controller";
import { MegaSaleService } from "../megasale.service";
import { activeOrUpcomingSale, MEGA_SALES } from "../megasale-window.config";

const state = vi.hoisted(() => ({
  watchlistsAggregate: vi.fn(),
  productsUpdateMany: vi.fn(),
  productsUpdateOne: vi.fn(),
  productsFind: vi.fn(),
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "watchlists") return { aggregate: state.watchlistsAggregate };
        if (name === "products") {
          return {
            updateMany: state.productsUpdateMany,
            updateOne: state.productsUpdateOne,
            find: state.productsFind,
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    }),
  },
}));

describe("FR-GROW-003 — Mega Sale Mode", () => {
  const posthog = { capture: vi.fn() };

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete process.env.MONGODB_URI;
    state.watchlistsAggregate.mockReturnValue({ toArray: vi.fn(async () => []) });
    state.productsUpdateMany.mockResolvedValue({ modifiedCount: 0 });
    state.productsUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    state.productsFind.mockReturnValue({
      sort: vi.fn(() => ({
        limit: vi.fn(() => ({
          toArray: vi.fn(async () => []),
        })),
      })),
    });
    posthog.capture.mockClear();
  });

  it("detects pre/live/none sale windows in Asia/Ho_Chi_Minh event schedule", () => {
    expect(activeOrUpcomingSale(new Date("2026-09-02T17:00:00.000Z"))).toMatchObject({
      sale: expect.objectContaining({ slug: "2026-09-09" }),
      stage: "pre",
    });
    expect(activeOrUpcomingSale(new Date("2026-09-09T10:00:00.000Z"))).toMatchObject({
      sale: expect.objectContaining({ label: "9.9 Super Sale" }),
      stage: "live",
    });
    expect(activeOrUpcomingSale(new Date("2026-08-01T00:00:00.000Z"))).toEqual({ sale: null, stage: "none" });
    expect(MEGA_SALES).toHaveLength(4);
  });

  it("returns current sale through service/controller without database access", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-12T05:00:00.000Z"));
    const service = new MegaSaleService(posthog);
    const controller = new MegaSaleController(service);

    expect(controller.current()).toMatchObject({
      sale: expect.objectContaining({ slug: "2026-12-12" }),
      stage: "live",
    });
    expect(state.watchlistsAggregate).not.toHaveBeenCalled();
  });

  it("applies hot-tier override during live windows and reverts outside windows", async () => {
    process.env.MONGODB_URI = "mongodb://localhost/salenoti";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T02:00:00.000Z"));
    state.watchlistsAggregate.mockReturnValueOnce({
      toArray: vi.fn(async () => [{ _id: "123-456" }, { _id: "not-a-product-id" }, { _id: "789-111" }]),
    });
    const service = new MegaSaleService(posthog);

    await service.applyHotOverride();

    expect(state.watchlistsAggregate).toHaveBeenCalledWith([
      { $match: { status: "active", "alertConfig.triggers.kind": "flash_sale" } },
      { $group: { _id: "$productId" } },
      { $limit: 50_000 },
    ]);
    expect(state.productsUpdateOne).toHaveBeenCalledTimes(2);
    expect(state.productsUpdateOne).toHaveBeenCalledWith(
      { shopId: 123, itemId: 456 },
      { $set: { trackPriority: "hot", _megaSaleOverride: "2026-11-11" } },
    );
    expect(posthog.capture).toHaveBeenCalledWith("megasale_hot_override_applied", { slug: "2026-11-11", count: 3 });

    vi.setSystemTime(new Date("2026-11-12T03:00:00.000Z"));
    await service.applyHotOverride();
    expect(state.productsUpdateMany).toHaveBeenCalledWith(
      { _megaSaleOverride: { $exists: true } },
      { $set: { trackPriority: "mid" }, $unset: { _megaSaleOverride: "" } },
    );
  });

  it("no-ops without MongoDB and returns sanitized top-deal controller output", async () => {
    const service = new MegaSaleService(posthog);
    const controller = new MegaSaleController(service);

    await service.applyHotOverride();
    expect(state.productsUpdateMany).not.toHaveBeenCalled();

    const toArray = vi.fn(async () => [
      { shopId: 123, itemId: 456, name: "Áo", imageUrl: "https://img", currentPrice: 89_000, originalPrice: 129_000, currentDiscountPct: 31 },
    ]);
    const limit = vi.fn(() => ({ toArray }));
    const sort = vi.fn(() => ({ limit }));
    state.productsFind.mockReturnValueOnce({ sort });

    await expect(service.getTopDeals("missing")).resolves.toEqual([]);
    await expect(controller.topDeals("2026-09-09")).resolves.toEqual({
      items: [
        {
          productId: "123-456",
          name: "Áo",
          imageUrl: "https://img",
          currentPrice: 89_000,
          originalPrice: 129_000,
          currentDiscountPct: 31,
        },
      ],
    });
    expect(state.productsFind).toHaveBeenCalledWith({ _megaSaleOverride: "2026-09-09", currentDiscountPct: { $gte: 30 } });
    expect(sort).toHaveBeenCalledWith({ currentDiscountPct: -1, sales: -1 });
    expect(limit).toHaveBeenCalledWith(50);
  });
});
