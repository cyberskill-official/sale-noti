// FR-AFF-003 — productOfferV2 + shopOfferV2 resolver with dual-write to Mongo + Timescale.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ShopeeAffiliateClient } from "./shopee/client";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
import { redis } from "../queue/redis.client";
import type { ProductOfferNode } from "./shopee/types";

export type NormalizedOffer = ProductOfferNode & {
  currentPrice: number;
  originalPrice: number;
  currentDiscountPct: number;
  flashSale: boolean;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

@Injectable()
export class OfferResolverService {
  private readonly log = new Logger(OfferResolverService.name);

  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any,
  ) {}

  /** FR-AFF-003 §1 #1 — resolve and dual-write. Returns null when item is dead. */
  async resolveProductOffer(shopId: number, itemId: number): Promise<NormalizedOffer | null> {
    const startedAt = Date.now();
    const productId = `${shopId}-${itemId}`;
    let offer: ProductOfferNode | null;

    try {
      offer = await this.shopee.productOfferV2({ shopId, itemId });
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", phase: "resolve", productId } });
      throw e;
    }

    if (!offer) {
      await this.markDead(shopId, itemId, productId);
      this.posthog.capture("product_offer_resolved", {
        shopId,
        itemId,
        source: "v2",
        outcome: "dead",
        latency_ms: Date.now() - startedAt,
      });
      return null;
    }

    const currentPrice = Math.round(Number(offer.priceMin));
    const originalPrice = Math.round(Number(offer.priceMax >= offer.priceMin ? offer.priceMax : offer.priceMin));
    const currentDiscountPct =
      originalPrice > currentPrice ? Math.min(99, Math.round((1 - currentPrice / originalPrice) * 100)) : 0;
    const flashSale = (originalPrice > 0 && currentPrice < originalPrice * 0.7) || Boolean(offer.flashSale);
    const observedAt = new Date();

    await this.upsertProduct({
      shopId,
      itemId,
      productId,
      offer,
      currentPrice,
      originalPrice,
      currentDiscountPct,
      observedAt,
    });

    try {
      await timescale.insertPriceHistory({
        productId,
        shopId,
        region: "VN",
        observedAt,
        price: currentPrice,
        originalPrice,
        discountPct: currentDiscountPct,
        stock: offer.stock ?? null,
        flashSale,
        source: "affiliate_api",
      });
      await redis.publish("price_history_invalidate", productId);
    } catch (e) {
      // Outbox retry pattern lands in a follow-up FR; for now record + alert and don't fail the call.
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", phase: "timescale_write", productId } });
      this.log.warn(`Timescale write failed for ${productId}: ${(e as Error).message}`);
    }

    this.posthog.capture("product_offer_resolved", {
      shopId,
      itemId,
      commissionRate: Number(offer.commissionRate),
      priceVnd: currentPrice,
      source: "v2",
      flashSale,
      outcome: "live",
      latency_ms: Date.now() - startedAt,
    });

    return {
      ...offer,
      currentPrice,
      originalPrice,
      currentDiscountPct,
      flashSale,
    };
  }

  /** FR-AFF-003 §1 #2 — shop-level commission rate (1h cached). */
  async resolveShopOffer(shopId: number): Promise<{ shopId: string; commissionRate: number } | null> {
    const cacheKey = `shopee:shop_offer:${shopId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as { shopId: string; commissionRate: number };

    const node = await this.shopee.shopOfferV2({ shopId });
    if (!node) return null;

    const out = { shopId: node.shopId, commissionRate: Number(node.commissionRate) };
    await redis.setex(cacheKey, 3600, JSON.stringify(out));
    return out;
  }

  private async markDead(shopId: number, itemId: number, productId: string): Promise<void> {
    try {
      await mongo
        .db("salenoti")
        .collection("products")
        .updateOne({ shopId, itemId }, { $set: { deletedAt: new Date() } });
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", phase: "mongo_write", productId } });
      throw e;
    }
  }

  private async upsertProduct(args: {
    shopId: number;
    itemId: number;
    productId: string;
    offer: ProductOfferNode;
    currentPrice: number;
    originalPrice: number;
    currentDiscountPct: number;
    observedAt: Date;
  }): Promise<void> {
    const { shopId, itemId, productId, offer, currentPrice, originalPrice, currentDiscountPct, observedAt } = args;
    try {
      await mongo
        .db("salenoti")
        .collection("products")
        .findOneAndUpdate(
          { shopId, itemId },
          {
            $setOnInsert: {
              shopId,
              itemId,
              slug: slugify(offer.productName),
              trackPriority: "mid",
              _scheduleHash: this.scheduleHash(productId),
              createdAt: observedAt,
            },
            $set: {
              name: offer.productName,
              imageUrl: offer.imageUrl ?? null,
              currentPrice,
              originalPrice,
              currentDiscountPct,
              lastObservedAt: observedAt,
              affiliateLink: offer.productLink,
              commissionRate: Number(offer.commissionRate),
              sales: Number(offer.sales ?? 0),
              currency: "VND",
              updatedAt: observedAt,
            },
            $unset: { deletedAt: "" },
          },
          { upsert: true },
        );
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", phase: "mongo_write", productId } });
      throw e;
    }
  }

  /**
   * FR-WORKER-002 §1 #3 — deterministic hash used by the scheduler to spread
   * products evenly across the tier cadence window.
   */
  private scheduleHash(productId: string): number {
    let h = 5381;
    for (let i = 0; i < productId.length; i++) {
      h = ((h * 33) ^ productId.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}
