// FR-AFF-002 — generateShortLink with attribution.
import crypto from "node:crypto";
import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ObjectId } from "mongodb";
import { AccessTradeFallbackService } from "./accesstrade/fallback.service";
import { ShopeeApiError } from "./shopee/errors";
import { ShopeeAffiliateClient } from "./shopee/client";
import { redis } from "../queue/redis.client";
import { mongo } from "../db/mongo";

const SHOPEE_URL_REGEX = /^https:\/\/shopee\.vn\/.+-i\.\d+\.\d+(?:\?.*)?$/;
const CACHE_TTL_SECONDS = 86_400;
const LEASE_TTL_SECONDS = 5;

export type DeeplinkSource = "alert_email" | "alert_push" | "alert_telegram" | "deal_page" | "share_deal" | "ext";

export type GenerateInput = {
  userId: string;
  productId: string;
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

export class DeeplinkRateLimitError extends Error {
  readonly retryAfter = 60;

  constructor() {
    super("rate_limit");
    this.name = "DeeplinkRateLimitError";
  }
}

@Injectable()
export class DeeplinkService {
  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    private readonly cfg: ConfigService,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    private readonly accessTradeFallback: AccessTradeFallbackService,
  ) {}

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const startedAt = Date.now();
    await this.assertUserRateLimit(input.userId);

    const product = await this.lookupProduct(input.productId);
    if (!product) throw new BadRequestException("product_not_found");
    this.assertValidOrigin(product.url, input.productId);

    if (input.respectOtherPublisher) {
      const subIds = this.buildSubIds({ ...input, campaign: "respected" });
      await this.insertAffiliateLink(input, product.url, product.url, subIds, true);
      this.posthog.capture("affiliate_link_respected_publisher", {
        source: input.source,
        userIdHash: this.hash(input.userId).slice(0, 12),
        productIdHash: this.hash(input.productId).slice(0, 12),
        latency_ms: Date.now() - startedAt,
      });
      this.observe(startedAt, input, true, false, "respected");
      return { url: product.url, expiresAt: null, cached: false };
    }

    const subIds = this.buildSubIds(input);
    const cacheKey = `dl:${input.userId}:${input.productId}:${input.source}:${subIds[4]}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      await this.incrementCacheHit(cached, input.userId);
      this.observe(startedAt, input, false, true, subIds[4]);
      return { url: cached, expiresAt: null, cached: true };
    }

    const leaseKey = `${cacheKey}:lease`;
    const lease = await redis.set(leaseKey, "1", "EX", LEASE_TTL_SECONDS, "NX");
    if (lease !== "OK") {
      await this.sleep(50 + Math.floor(Math.random() * 100));
      const second = await redis.get(cacheKey);
      if (second) {
        await this.incrementCacheHit(second, input.userId);
        this.observe(startedAt, input, false, true, subIds[4]);
        return { url: second, expiresAt: null, cached: true };
      }
    }

    try {
      const { shortLink } = await this.shopee.generateShortLink({ originUrl: product.url, subIds });
      await this.insertAffiliateLink(input, product.url, shortLink, subIds, false);
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, shortLink);
      this.observe(startedAt, input, false, false, subIds[4]);
      return { url: shortLink, expiresAt: null, cached: false };
    } catch (error) {
      if (this.shouldUseAccessTradeFallback(error)) {
        const fallback = await this.accessTradeFallback.generateFallbackLink({
          originUrl: product.url,
          userId: input.userId,
          source: input.source,
          watchlistId: input.watchlistId,
          campaign: input.campaign,
          respectOtherPublisher: false,
        });

        await this.insertAffiliateLink(input, product.url, fallback.url, subIds, false);
        await redis.setex(cacheKey, CACHE_TTL_SECONDS, fallback.url);
        this.observe(startedAt, input, false, false, subIds[4]);
        return fallback;
      }

      throw error;
    } finally {
      if (lease === "OK") await redis.del(leaseKey).catch(() => undefined);
    }
  }

  private buildSubIds(input: GenerateInput): [string, string, string, string, string] {
    const userHash = this.hash(input.userId, this.deeplinkSalt()).slice(0, 12);
    const wlHash = input.watchlistId ? this.hash(input.watchlistId).slice(0, 8) : "0";
    return ["salenoti", userHash, wlHash, input.source, this.scrubCampaign(input.campaign)];
  }

  private async lookupProduct(productId: string): Promise<{ url: string } | null> {
    const match = productId.match(/^(\d+)-(\d+)$/);
    if (!match) return null;
    const shopId = Number(match[1]);
    const itemId = Number(match[2]);
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId, itemId });
    if (!product) return null;
    const url = product.affiliateLink ?? `https://shopee.vn/-i.${shopId}.${itemId}`;
    return { url };
  }

  private assertValidOrigin(originUrl: string, productId: string): void {
    if (!SHOPEE_URL_REGEX.test(originUrl)) throw new BadRequestException("invalid_shopee_url");
    const match = originUrl.match(/-i\.(\d+)\.(\d+)(?:\?.*)?$/);
    if (!match || `${match[1]}-${match[2]}` !== productId) {
      throw new BadRequestException("invalid_shopee_url");
    }
  }

  private async insertAffiliateLink(
    input: GenerateInput,
    originUrl: string,
    shortUrl: string,
    subIds: [string, string, string, string, string],
    respectOtherPublisher: boolean,
  ): Promise<void> {
    await mongo
      .db("salenoti")
      .collection("affiliate_links")
      .insertOne({
        userId: this.toObjectId(input.userId),
        productId: input.productId,
        watchlistId: input.watchlistId ? this.toObjectId(input.watchlistId) : null,
        subIds,
        originUrl,
        shortUrl,
        source: input.source,
        campaign: subIds[4],
        createdAt: new Date(),
        expiresAt: null,
        cacheHits: 0,
        respectOtherPublisher,
        conversions: [],
      });
  }

  private async incrementCacheHit(shortUrl: string, userId: string): Promise<void> {
    await mongo
      .db("salenoti")
      .collection("affiliate_links")
      .updateOne({ shortUrl, userId: this.toObjectId(userId) }, { $inc: { cacheHits: 1 } });
  }

  private async assertUserRateLimit(userId: string): Promise<void> {
    const bucket = `rl:deeplink:${userId}:${Math.floor(Date.now() / 60_000)}`;
    const used = await redis.incr(bucket);
    if (used === 1) await redis.expire(bucket, 60);
    if (used > 30) throw new DeeplinkRateLimitError();
  }

  private observe(
    startedAt: number,
    input: GenerateInput,
    respectOtherPublisher: boolean,
    cached: boolean,
    campaign: string,
  ): void {
    this.posthog.capture("affiliate_link_generated", {
      source: input.source,
      userIdHash: this.hash(input.userId).slice(0, 12),
      productIdHash: this.hash(input.productId).slice(0, 12),
      campaign,
      cached,
      respect_other_publisher: respectOtherPublisher,
      latency_ms: Date.now() - startedAt,
    });
  }

  private deeplinkSalt(): string {
    const salt = this.cfg.getOrThrow<string>("DEEPLINK_SALT");
    if (!/^[a-f0-9]{32,}$/i.test(salt)) throw new Error("DEEPLINK_SALT_WEAK");
    return salt;
  }

  private hash(s: string, salt = ""): string {
    return crypto
      .createHash("sha256")
      .update(s + salt)
      .digest("hex");
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
    return c.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "default";
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shouldUseAccessTradeFallback(error: unknown): boolean {
    if (!this.isAccessTradeFallbackEnabled()) return false;
    if (!(error instanceof ShopeeApiError)) return false;
    return error.code === "rate_limit" || error.code === "service_unavailable";
  }

  private isAccessTradeFallbackEnabled(): boolean {
    const raw = this.cfg.get("ACCESSTRADE_FALLBACK_ENABLED");
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      return ["1", "true", "yes", "on"].includes(normalized);
    }
    return false;
  }
}
