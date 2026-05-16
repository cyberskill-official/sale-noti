// FR-AFF-002 — generateShortLink with attribution.
import crypto from "node:crypto";
import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ObjectId } from "mongodb";
import { ShopeeAffiliateClient } from "./shopee/client";
import { redis } from "../queue/redis.client";
import { mongo } from "../db/mongo";

const SHOPEE_URL_REGEX = /^https:\/\/shopee\.vn\/.+-i\.\d+\.\d+(?:\?.*)?$/;

export type DeeplinkSource = "alert_email" | "alert_push" | "alert_telegram" | "deal_page" | "share_deal" | "ext";

export type GenerateInput = {
  userId: string;
  productId: string;   // shopId-itemId composite
  source: DeeplinkSource;
  watchlistId?: string;
  campaign?: string;
  respectOtherPublisher?: boolean;
};

export type GenerateResult = {
  url: string;
  expiresAt: Date | null;
  cached: boolean;
};

@Injectable()
export class DeeplinkService {
  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    private readonly cfg: ConfigService,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  async generate(input: GenerateInput): Promise<GenerateResult> {
    // FR-AFF-002 §1 #6 — load origin URL from products collection.
    const product = await this.lookupProduct(input.productId);
    if (!product) throw new BadRequestException("product_not_found");
    if (!SHOPEE_URL_REGEX.test(product.url)) throw new BadRequestException("invalid_shopee_url");

    // FR-AFF-002 §1 #8 — respect existing publisher cookie: return origin URL unchanged.
    if (input.respectOtherPublisher) {
      this.posthog.capture("affiliate_link_generated", {
        source: input.source,
        userId: this.hash(input.userId),
        productIdHashed: this.hash(input.productId).slice(0, 12),
        campaign: this.scrubCampaign(input.campaign),
        respect_other_publisher: true,
      });
      return { url: product.url, expiresAt: null, cached: false };
    }

    // FR-AFF-002 §1 #2 — sub-id semantics (5 slots).
    const userHash = this.hash(input.userId, this.cfg.getOrThrow<string>("DEEPLINK_SALT")).slice(0, 12);
    const wlHash = input.watchlistId ? this.hash(input.watchlistId).slice(0, 8) : "0";
    const subIds: [string, string, string, string, string] = [
      "salenoti",
      userHash,
      wlHash,
      input.source,
      this.scrubCampaign(input.campaign),
    ];

    // FR-AFF-002 §1 #5 — 24h cache keyed by (userId, productId, source, campaign).
    const cacheKey = `dl:${input.userId}:${input.productId}:${input.source}:${subIds[4]}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      this.posthog.capture("affiliate_link_generated", {
        source: input.source,
        userId: this.hash(input.userId),
        productIdHashed: this.hash(input.productId).slice(0, 12),
        campaign: subIds[4],
        cached: true,
      });
      // Bump cache_hits counter on the row for analytics.
      await mongo
        .db("salenoti")
        .collection("affiliate_links")
        .updateOne({ shortUrl: cached, userId: this.toObjectId(input.userId) }, { $inc: { cacheHits: 1 } });
      return { url: cached, expiresAt: null, cached: true };
    }

    const { shortLink } = await this.shopee.generateShortLink({ originUrl: product.url, subIds });

    await mongo.db("salenoti").collection("affiliate_links").insertOne({
      userId: this.toObjectId(input.userId),
      productId: input.productId,
      watchlistId: input.watchlistId ? this.toObjectId(input.watchlistId) : null,
      subIds,
      originUrl: product.url,
      shortUrl: shortLink,
      source: input.source,
      campaign: subIds[4],
      createdAt: new Date(),
      expiresAt: null,
      cacheHits: 0,
      conversions: [],
    });

    await redis.setex(cacheKey, 86_400, shortLink);

    this.posthog.capture("affiliate_link_generated", {
      source: input.source,
      userId: this.hash(input.userId),
      productIdHashed: this.hash(input.productId).slice(0, 12),
      campaign: subIds[4],
      cached: false,
    });

    return { url: shortLink, expiresAt: null, cached: false };
  }

  private async lookupProduct(productId: string): Promise<{ url: string } | null> {
    // productId is "<shopId>-<itemId>". Look up `products` (FR-AFF-003 writes this collection).
    const match = productId.match(/^(\d+)-(\d+)$/);
    if (!match) return null;
    const shopId = Number(match[1]);
    const itemId = Number(match[2]);
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId, itemId });
    if (!product) return null;
    // affiliateLink is the canonical origin URL for deeplink-ing (FR-AFF-003 §1 #4).
    const url = product.affiliateLink ?? `https://shopee.vn/-i.${shopId}.${itemId}`;
    return { url };
  }

  private hash(s: string, salt = ""): string {
    return crypto.createHash("sha256").update(s + salt).digest("hex");
  }

  private toObjectId(id: string): ObjectId | string {
    try {
      return new ObjectId(id);
    } catch {
      return id;
    }
  }

  private scrubCampaign(c: string | undefined): string {
    if (!c) return "default";
    // FR-AFF-002 §10 row 10 — cap to 20 chars; whitelist [A-Za-z0-9_-].
    return c.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "default";
  }
}
