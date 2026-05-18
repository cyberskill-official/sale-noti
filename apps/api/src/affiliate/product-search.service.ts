// FR-AFF-004 — paginated, cached productSearch wrapper.
import crypto from "node:crypto";
import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { ShopeeAffiliateClient } from "./shopee/client";
import { redis } from "../queue/redis.client";
import { mongo } from "../db/mongo";

export type Sort = "RELEVANCY" | "PRICE_ASC" | "PRICE_DESC" | "SALES_DESC";
const SEARCH_SORTS = ["RELEVANCY", "PRICE_ASC", "PRICE_DESC", "SALES_DESC"] as const satisfies readonly Sort[];

export type SearchInput = {
  keyword: string;
  pageNumber?: number;
  pageSize?: number;
  sort?: Sort;
};

export type SearchContext = {
  userIdHash?: string;
  userIdRaw?: string;
  ip?: string;
};

export type SearchResultItem = {
  shopId: string;
  itemId: string;
  productName: string;
  currentPrice: number;
  originalPrice: number;
  imageUrl: string | null;
  sales: number;
  affiliateLinkUrl: string | null;
};

export type SearchResult = {
  items: SearchResultItem[];
  count: number;
  pageNumber: number;
  pageSize: number;
  sort: Sort;
  cached: boolean;
};

type CachedSearchPayload = Omit<SearchResult, "cached">;

export class ProductSearchRateLimitError extends Error {
  readonly retryAfter = 60;

  constructor() {
    super("rate_limit");
    this.name = "ProductSearchRateLimitError";
  }
}

export function stripHtml(s: string): string {
  return s
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

export function scrubKeyword(kw: string): string {
  if (/@/.test(kw)) return "[redacted-email]";
  if (/^(\+?84|0)\d{9,10}$/.test(kw)) return "[redacted-phone]";
  if (/^\d{9,12}$/.test(kw)) return "[redacted-id]";
  return kw.slice(0, 60);
}

export function isProductSearchSort(value: unknown): value is Sort {
  return (SEARCH_SORTS as readonly unknown[]).includes(value);
}

@Injectable()
export class ProductSearchService {
  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
  ) {}

  async search(input: SearchInput, ctx: SearchContext = {}): Promise<SearchResult> {
    const startedAt = Date.now();
    const keyword = input.keyword.trim();
    if (!keyword) throw new BadRequestException("invalid_keyword");
    if (keyword.length > 200) throw new BadRequestException("keyword_too_long");

    const pageSize = input.pageSize ?? 10;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) throw new BadRequestException("invalid_pageSize");
    const pageNumber = input.pageNumber ?? 1;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 50)
      throw new BadRequestException("invalid_pageNumber");
    const sort: Sort = input.sort ?? "RELEVANCY";
    if (!isProductSearchSort(sort)) throw new BadRequestException("invalid_sort");

    await this.assertRateLimit(ctx);

    const cacheKey = this.cacheKey(keyword, pageNumber, pageSize, sort);
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedSearchPayload;
      const out = await this.withAffiliateLinks({ ...parsed, cached: true }, ctx.userIdRaw);
      this.observe(startedAt, keyword, out, ctx.userIdHash);
      return out;
    }

    const res = await this.shopee.productSearch({ keyword, pageNumber, pageSize, sort });
    const payload: CachedSearchPayload = {
      items: res.nodes.map((n) => ({
        shopId: n.shopId,
        itemId: n.itemId,
        productName: stripHtml(n.productName),
        currentPrice: Math.round(Number(n.priceMin)),
        originalPrice: Math.round(Number(n.priceMax >= n.priceMin ? n.priceMax : n.priceMin)),
        imageUrl: n.imageUrl ?? null,
        sales: Number(n.sales ?? 0),
        affiliateLinkUrl: null,
      })),
      count: res.nodes.length,
      pageNumber,
      pageSize,
      sort,
    };
    await redis.setex(cacheKey, 300, JSON.stringify(payload));

    const out = await this.withAffiliateLinks({ ...payload, cached: false }, ctx.userIdRaw);
    this.observe(startedAt, keyword, out, ctx.userIdHash);
    return out;
  }

  private async withAffiliateLinks(result: SearchResult, userIdRaw?: string): Promise<SearchResult> {
    if (!userIdRaw || result.items.length === 0) return result;
    const productIds = result.items.map((item) => `${item.shopId}-${item.itemId}`);
    const links = await mongo
      .db("salenoti")
      .collection("affiliate_links")
      .find({ userId: this.toObjectId(userIdRaw), productId: { $in: productIds } })
      .sort({ createdAt: -1 })
      .toArray();
    const byProduct = new Map<string, string>();
    for (const link of links) {
      if (!byProduct.has(link.productId)) byProduct.set(link.productId, link.shortUrl);
    }
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        affiliateLinkUrl: byProduct.get(`${item.shopId}-${item.itemId}`) ?? null,
      })),
    };
  }

  private async assertRateLimit(ctx: SearchContext): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const isAuthenticated = Boolean(ctx.userIdRaw);
    const key = isAuthenticated
      ? `rl:search:user:${ctx.userIdRaw}:${minute}`
      : `rl:search:ip:${this.ip24(ctx.ip ?? "0.0.0.0")}:${minute}`;
    const limit = isAuthenticated ? 30 : 10;
    const used = await redis.incr(key);
    if (used === 1) await redis.expire(key, 60);
    if (used > limit) throw new ProductSearchRateLimitError();
  }

  private observe(startedAt: number, keyword: string, out: SearchResult, userIdHash?: string): void {
    this.posthog.capture("product_search", {
      keyword: scrubKeyword(keyword),
      results: out.count,
      pageNumber: out.pageNumber,
      pageSize: out.pageSize,
      sort: out.sort,
      cached: out.cached,
      userIdHash,
      latency_ms: Date.now() - startedAt,
    });
  }

  private cacheKey(keyword: string, pageNumber: number, pageSize: number, sort: Sort): string {
    const cacheBase = `${keyword}|${pageNumber}|${pageSize}|${sort}`;
    return `product_search:${crypto.createHash("sha256").update(cacheBase).digest("hex").slice(0, 16)}`;
  }

  private ip24(ip: string): string {
    const first = ip.split(",")[0]?.trim() ?? "0.0.0.0";
    const parts = first.split(".");
    return parts.length >= 3 ? parts.slice(0, 3).join(".") : "0.0.0";
  }

  private toObjectId(id: string): ObjectId | string {
    try {
      return new ObjectId(id);
    } catch {
      return id;
    }
  }
}
