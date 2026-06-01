import { beforeEach, describe, expect, it, vi } from "vitest";

import { mongo } from "@/server/db/mongo";
import { couponService } from "../coupon.service";

vi.mock("@/server/db/mongo", () => ({
  mongo: {
    db: vi.fn(),
  },
}));

describe("CouponService", () => {
  const collection = {
    find: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mongo.db).mockReturnValue({
      collection: vi.fn().mockReturnValue(collection),
    } as any);
  });

  it("returns active coupons sorted by priority and keeps disclosure copy", async () => {
    collection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              couponId: "cpn-2",
              code: "FREESHIP10",
              title: "Free shipping 10k",
              storeName: "Shop A",
              sourceName: "official",
              priority: 1,
              updatedAt: new Date("2026-06-01T01:00:00Z"),
            },
            {
              couponId: "cpn-1",
              code: "SALE20",
              title: "20% off",
              storeName: "Shop B",
              sourceName: "manual",
              priority: 5,
              updatedAt: new Date("2026-06-01T02:00:00Z"),
            },
          ]),
        }),
      }),
    });

    const result = await couponService.listCoupons({ status: "active", limit: 24 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].couponId).toBe("cpn-1");
    expect(result.items[0].copyOnly).toBe(true);
    expect(result.items[0].disclosure).toContain("KHÔNG: tự áp coupon");
  });

  it("filters expired coupons and matches query across title, store, and code", async () => {
    collection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              couponId: "cpn-1",
              code: "SALE20",
              title: "20% off everything",
              storeName: "Shop B",
              sourceName: "manual",
              expiresAt: new Date("2026-07-01T00:00:00Z"),
              priority: 1,
              updatedAt: new Date("2026-06-01T02:00:00Z"),
            },
            {
              couponId: "cpn-2",
              code: "OLD5",
              title: "Expired coupon",
              storeName: "Shop C",
              sourceName: "partner",
              expiresAt: new Date("2026-05-01T00:00:00Z"),
              priority: 2,
              updatedAt: new Date("2026-05-02T00:00:00Z"),
            },
          ]),
        }),
      }),
    });

    const activeResult = await couponService.listCoupons({ query: "shop b", status: "active" });
    const expiredResult = await couponService.listCoupons({ query: "old5", status: "expired" });

    expect(activeResult.items).toHaveLength(1);
    expect(activeResult.items[0].storeName).toBe("Shop B");
    expect(expiredResult.items).toHaveLength(1);
    expect(expiredResult.items[0].status).toBe("expired");
  });

  it("hides private coupons and respects the limit cap", async () => {
    collection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              couponId: "cpn-private",
              code: "SECRET",
              title: "Private coupon",
              storeName: "Shop D",
              sourceName: "manual",
              isPrivate: true,
              priority: 99,
              updatedAt: new Date("2026-06-01T02:00:00Z"),
            },
            {
              couponId: "cpn-public",
              code: "PUBLIC",
              title: "Public coupon",
              storeName: "Shop E",
              sourceName: "manual",
              priority: 1,
              updatedAt: new Date("2026-06-01T02:00:00Z"),
            },
          ]),
        }),
      }),
    });

    const result = await couponService.listCoupons({ status: "all", limit: 1 });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].couponId).toBe("cpn-public");
  });
});
