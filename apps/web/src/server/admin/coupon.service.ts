import { z } from "zod";

import { AFFILIATE_DISCLOSURE_VI } from "@/lib/disclosure";
import { mongo } from "@/server/db/mongo";

export type CouponStatusFilter = "active" | "expired" | "all";
export type CouponRecordStatus = "active" | "expired";

export type CouponOffer = {
  couponId: string;
  title: string;
  code: string;
  storeName: string;
  sourceName: string;
  sourceUrl: string | null;
  summary: string | null;
  status: CouponRecordStatus;
  expiresAt: string | null;
  priority: number;
  copyOnly: true;
  disclosure: string;
  updatedAt: string;
};

export type CouponListResult = {
  items: CouponOffer[];
  total: number;
  generatedAt: string;
};

export const CouponListInputSchema = z.object({
  query: z.string().trim().max(80).optional(),
  status: z.enum(["active", "expired", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

type CouponListInput = z.infer<typeof CouponListInputSchema>;

function readString(document: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = document[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readNumber(document: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = document[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readDate(document: Record<string, unknown>, ...keys: string[]): Date | null {
  for (const key of keys) {
    const value = document[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  return null;
}

function normalizeCouponDocument(document: Record<string, unknown>): CouponOffer | null {
  const couponId = readString(document, "couponId", "id", "_id");
  const title = readString(document, "title", "name");
  const code = readString(document, "code", "couponCode", "promoCode");
  const storeName = readString(document, "storeName", "shopName", "merchantName");
  const sourceName = readString(document, "sourceName", "source", "providerName") ?? "manual";

  if (!couponId || !title || !code || !storeName) {
    return null;
  }

  const expiresAt = readDate(document, "expiresAt", "expiryAt", "validUntil");
  const updatedAt = readDate(document, "updatedAt", "lastUpdatedAt", "createdAt") ?? new Date();
  const priority = readNumber(document, "priority", "rank") ?? 0;
  const statusFromRecord = readString(document, "status");
  const status: CouponRecordStatus =
    statusFromRecord === "expired" || (expiresAt && expiresAt.getTime() < Date.now()) ? "expired" : "active";
  const sourceUrl = readString(document, "sourceUrl", "originUrl", "url");
  const summary = readString(document, "summary", "description", "notes");
  const isPrivate = Boolean(document.isPrivate);

  if (isPrivate) {
    return null;
  }

  return {
    couponId,
    title,
    code,
    storeName,
    sourceName,
    sourceUrl,
    summary,
    status,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    priority,
    copyOnly: true,
    disclosure: AFFILIATE_DISCLOSURE_VI,
    updatedAt: updatedAt.toISOString(),
  };
}

function matchesQuery(offer: CouponOffer, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const haystack = [offer.code, offer.title, offer.storeName, offer.sourceName, offer.summary ?? ""]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalized);
}

export class CouponService {
  async listCoupons(input: Partial<CouponListInput> = {}): Promise<CouponListResult> {
    const parsed = CouponListInputSchema.parse(input);
    const collection = mongo.db("salenoti").collection("coupon_offers");
    const documents = await collection
      .find({ isPrivate: { $ne: true } })
      .sort({ priority: -1, updatedAt: -1 })
      .limit(200)
      .toArray();

    const normalized = documents
      .map((document) => normalizeCouponDocument(document as Record<string, unknown>))
      .filter((offer): offer is CouponOffer => Boolean(offer));

    const filtered = normalized.filter((offer) => {
      if (parsed.status !== "all" && offer.status !== parsed.status) {
        return false;
      }

      return matchesQuery(offer, parsed.query ?? "");
    });

    const ordered = [...filtered].sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }

      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt);
      }

      return left.title.localeCompare(right.title);
    });

    return {
      items: ordered.slice(0, parsed.limit),
      total: ordered.length,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const couponService = new CouponService();
