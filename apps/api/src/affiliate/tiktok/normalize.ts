import type { TikTokShopNormalizedOffer } from "./types";

export function normalizeTikTokShopProduct(input: {
  productId: string;
  title: string;
  price: number;
  originalPrice?: number | null;
  imageUrl?: string | null;
  commissionRate?: number | null;
  openCollaboration: boolean;
}): TikTokShopNormalizedOffer {
  const currentPrice = Math.round(input.price);
  const originalPrice = Math.round(input.originalPrice ?? input.price);
  const discountPct = originalPrice > currentPrice && originalPrice > 0 ? Math.round((1 - currentPrice / originalPrice) * 100) : 0;

  return {
    platform: "tiktok_shop",
    platformProductId: `tiktok_shop:${input.productId}`,
    productId: input.productId,
    title: input.title,
    currentPrice,
    originalPrice,
    discountPct,
    imageUrl: input.imageUrl ?? null,
    commissionRate: typeof input.commissionRate === "number" && Number.isFinite(input.commissionRate) ? input.commissionRate : null,
    currency: "VND",
    openCollaboration: input.openCollaboration,
  };
}
