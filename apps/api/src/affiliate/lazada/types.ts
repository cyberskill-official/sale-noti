export interface LazadaNormalizedOffer {
  platform: "lazada";
  platformProductId: string;
  shopId: number;
  itemId: number;
  productName: string;
  currentPrice: number;
  originalPrice: number;
  discountPct: number;
  imageUrl: string | null;
  affiliateLink: string;
  commissionRate: number | null;
  currency: "VND";
  flashSale: boolean;
}

export interface LazadaProductOfferInput {
  shopId: number;
  itemId: number;
}
