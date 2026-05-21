import type { LazadaNormalizedOffer } from "./types";

export function normalizeLazadaOffer(input: {
  shopId: number;
  itemId: number;
  title: string;
  price: number;
  originalPrice?: number | null;
  imageUrl?: string | null;
  affiliateLink: string;
  commissionRate?: number | null;
  flashSale?: boolean;
}): LazadaNormalizedOffer {
  const currentPrice = Math.round(input.price);
  const originalPrice = Math.round(input.originalPrice ?? input.price);
  const discountPct = originalPrice > currentPrice && originalPrice > 0 ? Math.min(99, Math.round((1 - currentPrice / originalPrice) * 100)) : 0;

  return {
    platform: "lazada",
    platformProductId: `lazada:${input.shopId}-${input.itemId}`,
    shopId: input.shopId,
    itemId: input.itemId,
    productName: input.title,
    currentPrice,
    originalPrice,
    discountPct,
    imageUrl: input.imageUrl ?? null,
    affiliateLink: input.affiliateLink,
    commissionRate: typeof input.commissionRate === "number" && Number.isFinite(input.commissionRate) ? input.commissionRate : null,
    currency: "VND",
    flashSale: Boolean(input.flashSale),
  };
}
