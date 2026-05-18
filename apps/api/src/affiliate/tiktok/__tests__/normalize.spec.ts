import { describe, expect, it } from "vitest";
import { normalizeTikTokShopProduct } from "../normalize";

describe("FR-AFF-006 — normalizeTikTokShopProduct", () => {
  it("normalizes TikTok Shop affiliate products", () => {
    const offer = normalizeTikTokShopProduct({
      productId: "987654321",
      title: "Ao khoac mua he",
      price: 199000,
      originalPrice: 299000,
      imageUrl: "https://img.example/tiktokshop.jpg",
      commissionRate: 10,
      openCollaboration: true,
    });

    expect(offer).toMatchObject({
      platform: "tiktok_shop",
      platformProductId: "tiktok_shop:987654321",
      productId: "987654321",
      currentPrice: 199000,
      originalPrice: 299000,
      discountPct: 33,
      commissionRate: 10,
      openCollaboration: true,
    });
  });

  it("falls back to null commission rate and 0 discount when needed", () => {
    const offer = normalizeTikTokShopProduct({
      productId: "1",
      title: "Ao thun",
      price: 100000,
      originalPrice: null,
      openCollaboration: false,
    });

    expect(offer.commissionRate).toBeNull();
    expect(offer.discountPct).toBe(0);
    expect(offer.openCollaboration).toBe(false);
  });
});
