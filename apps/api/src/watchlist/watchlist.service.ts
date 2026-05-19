// FR-WATCH-001/002/003 — watchlist service. Wires URL parsing, offer resolver, alert config, CRUD + cap.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import crypto from "node:crypto";
import { ObjectId, type Filter } from "mongodb";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
import { redis } from "../queue/redis.client";
import { OfferResolverService } from "../affiliate/offer-resolver.service";
import { parseShopeeUrl } from "./url-parser";
import { AlertConfigSchema, DEFAULT_ALERT_CONFIG, type Trigger } from "./alert-config.zod";

const FREE_TIER_CAP = 10;

export type TrackInput = {
  userId: string;
  url: string;
  alertConfig?: unknown;
  nickname?: string;
  source?: "web" | "ext" | "share" | "import";
  ip?: string;
  idempotencyKey?: string;
};

export type TrackResult = {
  watchlistId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  currentPrice: number;
  originalPrice: number;
  discountPct: number;
  affiliateLink: string;
  is30DayLow: boolean;
  last30dMin: number | null;
};

export class TrackRateLimitError extends Error {
  readonly retryAfter = 60;

  constructor(readonly scope: "user" | "ip") {
    super("RATE_LIMIT_TRACK");
    this.name = "TrackRateLimitError";
  }
}

@Injectable()
export class WatchlistService {
  constructor(
    private readonly resolver: OfferResolverService,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  /** FR-WATCH-001 §6 — POST /v1/products/track */
  async track(input: TrackInput): Promise<TrackResult> {
    const parsed = parseShopeeUrl(input.url);
    if (!parsed) throw new BadRequestException({ error: "invalid_shopee_url" });

    const userOid = this.toObjectId(input.userId);
    await this.assertRateLimit(input.userId, input.ip);

    const idemKey = this.idempotencyKey(input.userId, input.idempotencyKey);
    if (idemKey) {
      const cached = await redis.get(idemKey);
      if (cached) return JSON.parse(cached) as TrackResult;
    }

    const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid });
    if (!user) throw new ForbiddenException({ error: "unauthenticated" });

    const watchlists = mongo.db("salenoti").collection("watchlists");
    const productId = `${parsed.shopId}-${parsed.itemId}`;
    const validated = normalizeAlertConfig(input.alertConfig);
    const nickname = sanitizeNickname(input.nickname);
    const existing = await watchlists.findOne({ userId: userOid, productId });
    if (existing?.status === "active") {
      throw new ConflictException({
        error: "already_tracking",
        watchlistId: String(existing._id),
        status: existing.status,
        createdAt: existing.createdAt,
      });
    }
    const activeCount = await watchlists.countDocuments({ userId: userOid, status: "active" });

    if (user.plan === "free") {
      if (activeCount >= FREE_TIER_CAP) {
        const oldest = await watchlists.find({ userId: userOid, status: "active" }).sort({ createdAt: 1 }).limit(1).next();
        throw new ForbiddenException({
          error: "free_tier_cap_reached",
          limit: FREE_TIER_CAP,
          currentCount: activeCount,
          upgradeUrl: "/billing/upgrade",
          availableAt: oldest?.createdAt instanceof Date ? oldest.createdAt.toISOString() : null,
        });
      }
    }

    const offer = await this.resolver.resolveProductOffer(parsed.shopId, parsed.itemId);
    if (!offer) {
      throw new NotFoundException({
        error: "product_not_available",
        message: "Item không tồn tại trong Shopee Affiliate catalog. Có thể đã hết hàng.",
      });
    }

    const now = new Date();
    const configForPriority = existing?.alertConfig ?? validated;
    const wlDoc = {
      userId: userOid,
      productId,
      status: "active" as const,
      alertConfig: validated,
      nickname,
      commissionRateAtTrack: Number(offer.commissionRate),
      baselineAtTrack: offer.currentPrice,
      triggerCooldowns: {},
      lastTriggeredAt: null as Date | null,
      lastNotifiedAt: null as Date | null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null as Date | null,
      source: input.source ?? "web",
    };

    let watchlistId: string;
    try {
      if (existing && (existing.status === "paused" || existing.status === "deleted")) {
        watchlistId = String(existing._id);
        await watchlists.updateOne(
          { _id: existing._id },
          {
            $set: {
              status: "active",
              updatedAt: now,
              deletedAt: null,
              source: input.source ?? existing.source ?? "web",
            },
          },
        );
      } else {
        const insert = await watchlists.insertOne(wlDoc);
        watchlistId = String(insert.insertedId);
      }

      await this.updateProductPriority(parsed.shopId, parsed.itemId, priorityFromAlertConfig(configForPriority));
      const last30dMin = await timescale.getLast30dMin(productId).catch(() => null);
      const result = {
        watchlistId,
        productId,
        name: offer.productName,
        imageUrl: offer.imageUrl ?? null,
        currentPrice: offer.currentPrice,
        originalPrice: offer.originalPrice,
        discountPct: offer.currentDiscountPct,
        affiliateLink: offer.productLink,
        is30DayLow: last30dMin !== null ? offer.currentPrice <= last30dMin : false,
        last30dMin,
      };

      this.posthog.capture("product_tracked", {
        userId: this.hashUserId(input.userId),
        shopId: parsed.shopId,
        itemId: parsed.itemId,
        productId,
        source: input.source ?? "web",
        hasNickname: Boolean(nickname),
        triggerCount: configForPriority.triggers.length,
        freeTierCountAfter: activeCount + (existing?.status === "active" ? 0 : 1),
      });

      if (idemKey) await redis.setex(idemKey, 60, JSON.stringify(result));
      return result;
    } catch (e: any) {
      // FR-WATCH-001 §1 #5 — duplicate (userId, productId) → 409 with existing id.
      if (e?.code === 11000) {
        const duplicate = await watchlists.findOne({ userId: userOid, productId });
        throw new ConflictException({
          error: "already_tracking",
          watchlistId: String(duplicate?._id),
          status: duplicate?.status,
          createdAt: duplicate?.createdAt,
        });
      }
      throw e;
    }
  }

  /** FR-WATCH-003 §6 — paginated list with $lookup. */
  async list(input: { userId: string; status?: "active" | "paused" | "all"; page?: number; size?: number }) {
    const userOid = this.toObjectId(input.userId);
    const size = Math.min(Math.max(input.size ?? 20, 1), 50);
    const page = Math.max(input.page ?? 1, 1);
    const match: Filter<any> = { userId: userOid };
    if (input.status && input.status !== "all") match.status = input.status;
    else if (!input.status) match.status = "active";

    const pipeline = [
      { $match: match },
      { $sort: { updatedAt: -1, _id: -1 } },
      { $skip: (page - 1) * size },
      { $limit: size },
      {
        $lookup: {
          from: "products",
          let: { pid: "$productId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [
                    { $concat: [{ $toString: "$shopId" }, "-", { $toString: "$itemId" }] },
                    "$$pid",
                  ],
                },
              },
            },
            { $project: { _id: 0, name: 1, imageUrl: 1, currentPrice: 1, originalPrice: 1, currentDiscountPct: 1, lastObservedAt: 1, affiliateLink: 1 } },
          ],
          as: "p",
        },
      },
      { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
    ];

    const items = await mongo.db("salenoti").collection("watchlists").aggregate(pipeline).toArray();

    // Enrich with last30dMin from Timescale in parallel (best-effort; degrades to null).
    const enriched = await Promise.all(
      items.map(async (row: any) => {
        let last30dMin: number | null = null;
        try {
          last30dMin = await timescale.getLast30dMin(row.productId);
        } catch {}
        return {
          watchlistId: String(row._id),
          productId: row.productId,
          status: row.status,
          alertConfig: row.alertConfig,
          triggerCooldowns: row.triggerCooldowns ?? {},
          baselineAtTrack: row.baselineAtTrack,
          lastTriggeredAt: row.lastTriggeredAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt ?? null,
          name: row.p?.name ?? null,
          imageUrl: row.p?.imageUrl ?? null,
          currentPrice: row.p?.currentPrice ?? null,
          originalPrice: row.p?.originalPrice ?? null,
          currentDiscountPct: row.p?.currentDiscountPct ?? null,
          lastObservedAt: row.p?.lastObservedAt ?? null,
          last30dMin,
        };
      })
    );

    const total = await mongo.db("salenoti").collection("watchlists").countDocuments(match);
    return { items: enriched, page, size, total };
  }

  /** FR-WATCH-002 §6 — PATCH /v1/watchlists/:id alert config + status. */
  async patch(input: {
    userId: string;
    watchlistId: string;
    alertConfig?: unknown;
    status?: "active" | "paused";
    source?: "web" | "ext";
  }) {
    const userOid = this.toObjectId(input.userId);
    const wlOid = this.toObjectId(input.watchlistId);
    const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: wlOid, userId: userOid });
    if (!wl) throw new ForbiddenException();

    const $set: Record<string, unknown> = { updatedAt: new Date() };

    if (input.alertConfig !== undefined) {
      const parsed = AlertConfigSchema.safeParse(input.alertConfig);
      if (!parsed.success) {
        const duplicate = parsed.error.issues.some((issue) => issue.message === "duplicate_trigger_kind");
        throw new BadRequestException({
          error: duplicate ? "duplicate_trigger_kind" : "invalid_alert_config",
          issues: parsed.error.issues,
        });
      }
      $set.alertConfig = parsed.data;
      this.posthog.capture("watchlist_alert_config_changed", {
        watchlistIdHash: this.hashWatchlistId(input.watchlistId),
        triggerKinds: parsed.data.triggers.map((trigger) => trigger.kind),
        source: input.source ?? "web",
      });
    }

    // FR-WATCH-003 §1 #6 — reactivating paused → enforce 10-product cap.
    if (input.status === "active" && wl.status !== "active") {
      const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid });
      if (user?.plan === "free") {
        const count = await mongo
          .db("salenoti")
          .collection("watchlists")
          .countDocuments({ userId: userOid, status: "active" });
        if (count >= FREE_TIER_CAP) {
          throw new ForbiddenException({
            error: "free_tier_cap_reached",
            limit: FREE_TIER_CAP,
            upgradeUrl: "/billing/upgrade",
          });
        }
      }
      $set.status = "active";
      this.posthog.capture("watchlist_resumed", {
        watchlistIdHash: this.hashWatchlistId(input.watchlistId),
        source: input.source ?? "web",
      });
    } else if (input.status === "paused") {
      $set.status = "paused";
      this.posthog.capture("watchlist_paused", {
        watchlistIdHash: this.hashWatchlistId(input.watchlistId),
        source: input.source ?? "web",
      });
    }

    await mongo.db("salenoti").collection("watchlists").updateOne({ _id: wlOid }, { $set });
    return await mongo.db("salenoti").collection("watchlists").findOne({ _id: wlOid });
  }

  /** FR-WATCH-003 §1 #5 — soft delete (status: deleted + deletedAt). */
  async softDelete(input: { userId: string; watchlistId: string; source?: "web" | "ext" }) {
    const userOid = this.toObjectId(input.userId);
    const wlOid = this.toObjectId(input.watchlistId);
    const r = await mongo
      .db("salenoti")
      .collection("watchlists")
      .findOneAndUpdate(
        { _id: wlOid, userId: userOid },
        { $set: { status: "deleted", deletedAt: new Date(), updatedAt: new Date() } },
        { returnDocument: "after" }
      );
    if (!r) throw new ForbiddenException();
    this.posthog.capture("watchlist_deleted", {
      watchlistIdHash: this.hashWatchlistId(input.watchlistId),
      source: input.source ?? "web",
    });
    return { ok: true };
  }

  private toObjectId(id: string): ObjectId {
    try {
      return new ObjectId(id);
    } catch {
      throw new BadRequestException({ error: "invalid_id" });
    }
  }

  private async updateProductPriority(shopId: number, itemId: number, trackPriority: "hot" | "mid") {
    await mongo.db("salenoti").collection("products").updateOne({ shopId, itemId }, { $set: { trackPriority } });
  }

  private async assertRateLimit(userId: string, ip = "0.0.0.0"): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const userKey = `rl:track:user:${userId}:${minute}`;
    const ipKey = `rl:track:ip:${ip24(ip)}:${minute}`;
    const userUsed = await redis.incr(userKey);
    if (userUsed === 1) await redis.expire(userKey, 60);
    if (userUsed > 20) throw new TrackRateLimitError("user");
    const ipUsed = await redis.incr(ipKey);
    if (ipUsed === 1) await redis.expire(ipKey, 60);
    if (ipUsed > 5) throw new TrackRateLimitError("ip");
  }

  private idempotencyKey(userId: string, idempotencyKey?: string): string | null {
    if (!idempotencyKey) return null;
    return `idem:track:${userId}:${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
  }

  private hashUserId(userId: string): string {
    return crypto
      .createHash("sha256")
      .update(userId + (process.env.POSTHOG_PII_SALT ?? ""))
      .digest("hex")
      .slice(0, 16);
  }

  private hashWatchlistId(watchlistId: string): string {
    return crypto.createHash("sha256").update(watchlistId).digest("hex").slice(0, 12);
  }
}

function ip24(ip: string): string {
  const first = ip.split(",")[0]?.trim() ?? "0.0.0.0";
  const parts = first.split(".");
  return parts.length >= 3 ? parts.slice(0, 3).join(".") : "0.0.0";
}

export function sanitizeNickname(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  if (/[<>`]/.test(normalized)) throw new UnprocessableEntityException({ error: "invalid_nickname" });
  return normalized.slice(0, 60) || undefined;
}

function normalizeAlertConfig(input: unknown): { triggers: Trigger[] } {
  if (input === undefined) return DEFAULT_ALERT_CONFIG;
  const direct = AlertConfigSchema.safeParse(input);
  if (direct.success) return direct.data;
  if (!input || typeof input !== "object") {
    throw new UnprocessableEntityException({ error: "invalid_alert_config" });
  }
  const raw = input as {
    triggers?: unknown[];
    minDropPct?: unknown;
    targetPrice?: unknown;
    lowest30d?: unknown;
    flashSale?: unknown;
  };
  const triggerKinds = new Set<string>();
  for (const trigger of raw.triggers ?? []) {
    if (typeof trigger === "string") triggerKinds.add(trigger);
    else if (trigger && typeof trigger === "object" && "kind" in trigger) triggerKinds.add(String(trigger.kind));
  }
  if (raw.lowest30d === true) triggerKinds.add("lowest_30d");
  if (raw.flashSale === true) triggerKinds.add("flash_sale");
  if (triggerKinds.size === 0) triggerKinds.add("pct_drop");

  const triggers: Trigger[] = [];
  for (const kind of triggerKinds) {
    if (kind === "pct_drop") {
      triggers.push({
        kind,
        minDropPct: typeof raw.minDropPct === "number" ? raw.minDropPct : 10,
        baseline: "current_at_track",
        paused: false,
      });
    } else if (kind === "absolute_drop") {
      if (typeof raw.targetPrice !== "number") throw new UnprocessableEntityException({ error: "invalid_alert_config" });
      triggers.push({ kind, targetPrice: raw.targetPrice, paused: false });
    } else if (kind === "lowest_30d") {
      triggers.push({ kind, paused: false });
    } else if (kind === "flash_sale") {
      triggers.push({
        kind,
        minDiscountPct: typeof raw.minDropPct === "number" ? raw.minDropPct : 30,
        paused: false,
      });
    }
  }

  if (triggers.length === 0) throw new UnprocessableEntityException({ error: "invalid_alert_config" });
  const parsed = AlertConfigSchema.safeParse({ triggers });
  if (!parsed.success) throw new UnprocessableEntityException({ error: "invalid_alert_config", issues: parsed.error.issues });
  return parsed.data;
}

function priorityFromAlertConfig(alertConfig: { triggers: Trigger[] }): "hot" | "mid" {
  return alertConfig.triggers.some((trigger) => trigger.kind === "flash_sale" && !trigger.paused) ? "hot" : "mid";
}
