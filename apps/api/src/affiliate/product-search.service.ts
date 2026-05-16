// FR-AFF-004 — paginated, cached productSearch wrapper.
import crypto from "node:crypto";
import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { ShopeeAffiliateClient } from "./shopee/client";
import { redis } from "../queue/redis.client";

type Sort = "RELEVANCY" | "PRICE_ASC" | "PRICE_DESC" | "SALES_DESC";

export type SearchInput = {
  keyword: string;
  pageNumber?: number;
  pageSize?: number;
  sort?: Sort;
};

export type SearchResultItem = {
  shopId: string;
  itemId: string;
  productName: string;
  currentPrice: number;
  originalPrice: number;
  imageUrl: string | null;
  sales: number;
  affiliateLink: string | null;
};

export type SearchResult = {
  items: SearchResultItem[];
  count: number;
  pageNumber: number;
  cached: boolean;
};

function stripHtml(s: string): string {
  // FR-AFF-004 §1 #5 — XSS strip. Remove dangerous-content tags entirely (including inner text),
  // THEN strip remaining tags but keep their text content. Order matters: `<script>alert(1)</script>OK`
  // must become `OK`, not `alert(1)OK`. Tags covered: script, style, iframe, object, embed.
  return s
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function scrubKeyword(kw: string): string {
  if (/@/.test(kw)) return "[redacted-email]";
  return kw.slice(0, 60);
}

@Injectable()
export class ProductSearchService {
  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  async search(input: SearchInput, ctx: { userIdHash?: string }): Promise<SearchResult> {
    const pageSize = Math.min(input.pageSize ?? 10, 20);
    if (input.pageSize && input.pageSize > 20) throw new BadRequestException("invalid_pageSize");
    const pageNumber = input.pageNumber ?? 1;
    const sort: Sort = input.sort ?? "RELEVANCY";

    const cacheBase = `${input.keyword}|${pageNumber}|${pageSize}|${sort}`;
    const cacheKey = `product_search:${crypto.createHash("sha256").update(cacheBase).digest("hex").slice(0, 16)}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as SearchResult;
      this.posthog.capture("product_search", {
        keyword: scrubKeyword(input.keyword),
        results: parsed.count,
        pageNumber,
        cached: true,
        userId: ctx.userIdHash,
      });
      return { ...parsed, cached: true };
    }

    const res = await this.shopee.productSearch({
      keyword: input.keyword,
      pageNumber,
      pageSize,
      sort,
    });

    const items: SearchResultItem[] = res.nodes.map((n) => ({
      shopId: n.shopId,
      itemId: n.itemId,
      productName: stripHtml(n.productName),
      currentPrice: Math.round(Number(n.priceMin)),
      originalPrice: Math.round(Number(n.priceMax >= n.priceMin ? n.priceMax : n.priceMin)),
      imageUrl: n.imageUrl ?? null,
      sales: Number(n.sales ?? 0),
      affiliateLink: null,
    }));

    const out: SearchResult = { items, count: items.length, pageNumber, cached: false };
    // FR-AFF-004 §1 #2 — cache 5 minutes.
    await redis.setex(cacheKey, 300, JSON.stringify(out));

    this.posthog.capture("product_search", {
      keyword: scrubKeyword(input.keyword),
      results: out.count,
      pageNumber,
      cached: false,
      userId: ctx.userIdHash,
    });

    return out;
  }
}
