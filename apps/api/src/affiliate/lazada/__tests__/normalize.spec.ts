import { describe, expect, it } from "vitest";
import { normalizeLazadaOffer } from "../normalize";

describe("FR-AFF-005 — normalizeLazadaOffer", () => {
  it("normalizes Lazada payloads", () => {
    const offer = normalizeLazadaOffer({
      shopId: 123,
      itemId: 456,
      title: "Ao thun basic",
      price: 89_000,
      originalPrice: 129_000,
      imageUrl: "https://img.example/lazada.jpg",
      affiliateLink: "https://lazada.vn/aff/abc",
      commissionRate: 7.5,
      flashSale: true,
    });

    expect(offer).toMatchObject({
      platform: "lazada",
      platformProductId: "lazada:123-456",
      shopId: 123,
      itemId: 456,
      productName: "Ao thun basic",
      currentPrice: 89_000,
      originalPrice: 129_000,
      discountPct: 31,
      imageUrl: "https://img.example/lazada.jpg",
      affiliateLink: "https://lazada.vn/aff/abc",
      commissionRate: 7.5,
      currency: "VND",
      flashSale: true,
    });
  });

  it("falls back to null commission rate and zero discount", () => {
    const offer = normalizeLazadaOffer({
      shopId: 1,
      itemId: 2,
      title: "Ao khoac",
      price: 100_000,
      originalPrice: null,
      affiliateLink: "https://lazada.vn/aff/xyz",
    });

    expect(offer.commissionRate).toBeNull();
    expect(offer.discountPct).toBe(0);
    expect(offer.flashSale).toBe(false);
  });
});
