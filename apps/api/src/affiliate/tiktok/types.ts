export type { TikTokShopApiErrorCode } from "./errors";

export interface TikTokShopNormalizedOffer {
  platform: "tiktok_shop";
  platformProductId: string;
  productId: string;
  title: string;
  currentPrice: number;
  originalPrice: number;
  discountPct: number;
  imageUrl: string | null;
  commissionRate: number | null;
  currency: "VND";
  openCollaboration: boolean;
}

export interface TikTokShopPromotionLink {
  productId: string;
  platformProductId: string;
  promotionLink: string;
  generatedAt: string;
}

export interface TikTokShopSearchInput {
  keyword?: string;
  categoryIds?: string[];
  commissionRateMin?: number;
  page?: number;
  pageSize?: number;
}

export type TikTokShopRawRecord = Record<string, unknown>;
