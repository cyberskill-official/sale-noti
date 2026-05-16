// FR-AFF-003 — productOfferV2 + shopOfferV2 resolver with dual-write to Mongo + Timescale.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ShopeeAffiliateClient } from "./shopee/client";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
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
    @Inject("OBS_SENTRY") private readonly sentry: any
  ) {}

  /** FR-AFF-003 §1 #1 — resolve and dual-write. Returns null when item is dead. */
  async resolveProductOffer(shopId: number, itemId: number): Promise<NormalizedOffer | null> {
    const offer = await this.shopee.productOfferV2({ shopId, itemId });

    if (!offer) {
      // FR-AFF-003 §1 #6 — item dead handling.
      await mongo.db("salenoti").collection("products").updateOne(
        { shopId, itemId },
        { $set: { deletedAt: new Date() } }
      );
      this.posthog.capture("product_offer_resolved", { shopId, itemId, source: "v2", outcome: "dead" });
      return null;
    }

    const currentPrice = Math.round(Number(offer.priceMin));
    const originalPrice = Math.round(Number(offer.priceMax >= offer.priceMin ? offer.priceMax : offer.priceMin));
    const currentDiscountPct =
      originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : 0;
    // FR-AFF-003 §1 #7 — flash_sale = price < 70% of original.
    const flashSale = originalPrice > 0 && currentPrice < originalPrice * 0.7;

    const observedAt = new Date();
    const productId = `${shopId}-${itemId}`;

    // FR-AFF-003 §1 #4 — denormalise into MongoDB.
    await mongo.db("salenoti").collection("products").findOneAndUpdate(
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
          updatedAt: observedAt,
        },
        $unset: { deletedAt: "" }, // resurrected items (§10 row 4)
      },
      { upsert: true }
    );

    // FR-AFF-003 §1 #5 — dual-write into TimescaleDB price_history.
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
    } catch (e) {
      // Outbox retry pattern lands in a follow-up FR; for now record + alert and don't fail the call.
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", kind: "timescale_write_failed", productId } });
      this.log.warn(`Timescale write failed for ${productId}: ${(e as Error).message}`);
    }

    this.posthog.capture("product_offer_resolved", {
      shopId,
      itemId,
      commissionRate: Number(offer.commissionRate),
      priceVnd: currentPrice,
      source: "v2",
      flashSale,
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
    // Cache happens at caller level; see redis.client for the 1h key naming convention.
    return this.shopee.shopOfferV2({ shopId });
  }

  /**
   * FR-WORKER-002 §1 #3 — deterministic hash used by the scheduler to spread
   * products evenly across the tier cadence window.
   */
  private scheduleHash(productId: string): number {
    let h = 0;
    for (let i = 0; i < productId.length; i++) {
      h = (h * 31 + productId.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}
