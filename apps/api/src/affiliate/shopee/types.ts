// FR-AFF-001 §3 — zod schemas for Shopee Affiliate Open API responses.
import { z } from "zod";

const NumberLike = z.union([z.number(), z.string().transform((s) => Number(s))]);

export const ProductOfferNode = z.object({
  itemId: z.union([z.string(), z.number()]).transform(String),
  shopId: z.union([z.string(), z.number()]).transform(String),
  productName: z.string(),
  priceMin: NumberLike,
  priceMax: NumberLike,
  productLink: z.string().url(),
  commissionRate: NumberLike,
  sales: NumberLike.optional().default(0),
  imageUrl: z.string().nullable().optional(),
  stock: z.number().nullable().optional(),
  flashSale: z.boolean().optional(),
});
export type ProductOfferNode = z.infer<typeof ProductOfferNode>;

export const ProductOfferV2Response = z.object({
  productOfferV2: z.object({
    nodes: z.array(ProductOfferNode),
  }),
});

export const ShopOfferNode = z.object({
  shopId: z.union([z.string(), z.number()]).transform(String),
  commissionRate: NumberLike,
  shopType: z.string().optional(),
});
export const ShopOfferV2Response = z.object({
  shopOfferV2: z.object({
    nodes: z.array(ShopOfferNode),
  }),
});

export const ProductSearchResponse = z.object({
  productSearch: z.object({
    nodes: z.array(ProductOfferNode),
  }),
});

export const ShortLinkResponse = z.object({
  generateShortLink: z.object({
    shortLink: z.string().url(),
  }),
});
