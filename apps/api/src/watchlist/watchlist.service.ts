// FR-WATCH-001/002/003 — watchlist service. Wires URL parsing, offer resolver, alert config, CRUD + cap.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId, type Filter } from "mongodb";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
import { OfferResolverService } from "../affiliate/offer-resolver.service";
import { parseShopeeUrl } from "./url-parser";
import { AlertConfigSchema, DEFAULT_ALERT_CONFIG, type Trigger } from "./alert-config.zod";

const FREE_TIER_CAP = 10;

export type TrackInput = {
  userId: string;
  url: string;
  alertConfig?: { triggers?: Trigger[] };
  source?: "web" | "ext" | "share";
};

export type TrackResult = {
  watchlistId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  currentPrice: number;
  originalPrice: number;
  affiliateLink: string;
};

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
    const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid });
    if (!user) throw new ForbiddenException({ error: "unauthenticated" });

    if (user.plan === "free") {
      const count = await mongo
        .db("salenoti")
        .collection("watchlists")
        .countDocuments({ userId: userOid, status: "active" });
      if (count >= FREE_TIER_CAP) {
        throw new ForbiddenException({ error: "free_tier_cap_reached", limit: FREE_TIER_CAP, upgradeUrl: "/billing/upgrade" });
      }
    }

    const offer = await this.resolver.resolveProductOffer(parsed.shopId, parsed.itemId);
    if (!offer) throw new NotFoundException({ error: "product_not_available" });

    const productId = `${parsed.shopId}-${parsed.itemId}`;
    const validated = input.alertConfig
      ? AlertConfigSchema.parse(input.alertConfig)
      : DEFAULT_ALERT_CONFIG;

    const wlDoc = {
      userId: userOid,
      productId,
      status: "active" as const,
      alertConfig: validated,
      commissionRateAtTrack: Number(offer.commissionRate),
      baselineAtTrack: offer.currentPrice,
      triggerCooldowns: {},
      lastTriggeredAt: null as Date | null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null as Date | null,
    };

    try {
      const insert = await mongo.db("salenoti").collection("watchlists").insertOne(wlDoc);

      // FR-WATCH-001 §1 #7 — flash_sale trigger bumps product priority hot.
      if (validated.triggers.some((t: any) => t.kind === "flash_sale")) {
        await mongo
          .db("salenoti")
          .collection("products")
          .updateOne({ shopId: parsed.shopId, itemId: parsed.itemId }, { $set: { trackPriority: "hot" } });
      }

      this.posthog.capture("product_tracked", {
        shopId: parsed.shopId,
        itemId: parsed.itemId,
        source: input.source ?? "web",
        plan: user.plan,
      });

      return {
        watchlistId: String(insert.insertedId),
        productId,
        name: offer.productName,
        imageUrl: offer.imageUrl ?? null,
        currentPrice: offer.currentPrice,
        originalPrice: offer.originalPrice,
        affiliateLink: offer.productLink,
      };
    } catch (e: any) {
      // FR-WATCH-001 §1 #5 — duplicate (userId, productId) → 409 with existing id.
      if (e?.code === 11000) {
        const existing = await mongo
          .db("salenoti")
          .collection("watchlists")
          .findOne({ userId: userOid, productId });
        throw new ConflictException({ error: "already_tracking", watchlistId: String(existing?._id) });
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
      { $sort: { updatedAt: -1 } },
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

    return { items: enriched, page, size };
  }

  /** FR-WATCH-002 §6 — PATCH /v1/watchlists/:id alert config + status. */
  async patch(input: { userId: string; watchlistId: string; alertConfig?: unknown; status?: "active" | "paused" }) {
    const userOid = this.toObjectId(input.userId);
    const wlOid = this.toObjectId(input.watchlistId);
    const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: wlOid, userId: userOid });
    if (!wl) throw new ForbiddenException();

    const $set: Record<string, unknown> = { updatedAt: new Date() };

    if (input.alertConfig !== undefined) {
      const parsed = AlertConfigSchema.safeParse(input.alertConfig);
      if (!parsed.success) {
        throw new BadRequestException({ error: "invalid_alert_config", issues: parsed.error.issues });
      }
      $set.alertConfig = parsed.data;
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
      this.posthog.capture("watchlist_resumed", { watchlistId: input.watchlistId });
    } else if (input.status === "paused") {
      $set.status = "paused";
      this.posthog.capture("watchlist_paused", { watchlistId: input.watchlistId });
    }

    await mongo.db("salenoti").collection("watchlists").updateOne({ _id: wlOid }, { $set });
    return await mongo.db("salenoti").collection("watchlists").findOne({ _id: wlOid });
  }

  /** FR-WATCH-003 §1 #5 — soft delete (status: deleted + deletedAt). */
  async softDelete(input: { userId: string; watchlistId: string }) {
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
    this.posthog.capture("watchlist_deleted", { watchlistId: input.watchlistId });
    return { ok: true };
  }

  private toObjectId(id: string): ObjectId {
    try {
      return new ObjectId(id);
    } catch {
      throw new BadRequestException({ error: "invalid_id" });
    }
  }
}
