// FR-AFF-001 — Shopee Affiliate Open API client.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { signRequest } from "./sign";
import { ShopeeRateLimitGuard } from "./rate-limit-guard";
import { CircuitBreaker, BreakerOpenError } from "./circuit-breaker";
import { ShopeeApiError } from "./errors";
import {
  ProductOfferV2Response,
  ShopOfferV2Response,
  ProductSearchResponse,
  ShortLinkResponse,
  type ProductOfferNode,
} from "./types";
import { recordApiOutcome } from "../../scheduler/shopee-api-health";

const ENDPOINT = "https://open-api.affiliate.shopee.vn/graphql";
const TIMEOUT_MS = 10_000;

@Injectable()
export class ShopeeAffiliateClient {
  private readonly log = new Logger(ShopeeAffiliateClient.name);
  private readonly breaker = new CircuitBreaker();
  private clockSkewAttempt = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly rateLimit: ShopeeRateLimitGuard,
    @Inject("OBS_SENTRY") private readonly sentry: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  async productOfferV2(input: { itemId: number | string; shopId: number | string }): Promise<ProductOfferNode | null> {
    const query = `query { productOfferV2(itemId: ${input.itemId}, shopId: ${input.shopId}) { nodes { itemId shopId productName priceMin priceMax productLink commissionRate sales imageUrl stock } } }`;
    const data = await this.call(query);
    const parsed = this.parseSafe(ProductOfferV2Response, data);
    return parsed.productOfferV2.nodes[0] ?? null;
  }

  async shopOfferV2(input: { shopId: number | string }): Promise<{ shopId: string; commissionRate: number } | null> {
    const query = `query { shopOfferV2(shopId: ${input.shopId}) { nodes { shopId commissionRate shopType } } }`;
    const data = await this.call(query);
    const parsed = this.parseSafe(ShopOfferV2Response, data);
    const node = parsed.shopOfferV2.nodes[0];
    return node ? { shopId: node.shopId, commissionRate: Number(node.commissionRate) } : null;
  }

  async productSearch(input: {
    keyword: string;
    pageNumber?: number;
    pageSize?: number;
    sort?: "RELEVANCY" | "PRICE_ASC" | "PRICE_DESC" | "SALES_DESC";
  }): Promise<{ nodes: ProductOfferNode[] }> {
    const pageNumber = input.pageNumber ?? 1;
    const pageSize = Math.min(input.pageSize ?? 10, 20);
    const sort = input.sort ?? "RELEVANCY";
    const safeKw = JSON.stringify(input.keyword);
    const query = `query { productSearch(keyword: ${safeKw}, pageNumber: ${pageNumber}, pageSize: ${pageSize}, sort: "${sort}") { nodes { itemId shopId productName priceMin priceMax productLink commissionRate sales imageUrl } } }`;
    const data = await this.call(query);
    return this.parseSafe(ProductSearchResponse, data).productSearch;
  }

  async generateShortLink(input: { originUrl: string; subIds: [string, string, string, string, string] }): Promise<{ shortLink: string }> {
    const subIdsJson = JSON.stringify(input.subIds);
    const originJson = JSON.stringify(input.originUrl);
    const query = `mutation { generateShortLink(input: { originUrl: ${originJson}, subIds: ${subIdsJson} }) { shortLink } }`;
    const data = await this.call(query);
    return this.parseSafe(ShortLinkResponse, data).generateShortLink;
  }

  private parseSafe<T>(schema: { parse: (v: unknown) => T }, data: unknown): T {
    try {
      return schema.parse(data);
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-001", kind: "schema_drift" } });
      throw new ShopeeApiError("schema_drift", (e as Error).message);
    }
  }

  private async call(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.cfg.get("SHOPEE_AFFILIATE_APP_ID") || !this.cfg.get("SHOPEE_AFFILIATE_APP_SECRET")) {
      // Dev-mode stub: surface a typed error so callers can mock.
      throw new ShopeeApiError("auth_failure", "SHOPEE_AFFILIATE_APP_ID/SECRET not set in this env");
    }

    await this.rateLimit.acquire();

    try {
      return await this.breaker.exec(() => this.doRequest(query, variables));
    } catch (e) {
      if (e instanceof BreakerOpenError) throw new ShopeeApiError("service_unavailable", "circuit_breaker_open");
      throw e;
    }
  }

  private async doRequest(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const payload = JSON.stringify({ query, variables });
    const appId = this.cfg.getOrThrow<string>("SHOPEE_AFFILIATE_APP_ID");
    const appSecret = this.cfg.getOrThrow<string>("SHOPEE_AFFILIATE_APP_SECRET");
    const { header } = signRequest(payload, appId, appSecret);
    const startedAt = Date.now();
    let outcome: "success" | "error_429" | "error_5xx" | "error_4xx" | "timeout" = "success";
    let methodSlug = "unknown";
    const methodMatch = query.match(/\b(productOfferV2|shopOfferV2|productSearch|generateShortLink)\b/);
    if (methodMatch?.[1]) methodSlug = methodMatch[1];

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json", Authorization: header },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429) {
        outcome = "error_429";
        throw new ShopeeApiError("rate_limit");
      }
      if (res.status >= 500) {
        outcome = "error_5xx";
        throw new ShopeeApiError("service_unavailable", `Shopee ${res.status}`);
      }
      if (res.status >= 400) {
        outcome = "error_4xx";
        // FR-AFF-001 §1 #12 — clock-skew recovery: retry once with fresh timestamp.
        const body: any = await res.json().catch(() => ({}));
        const code = body?.errors?.[0]?.extensions?.code;
        if ((code === "INVALID_TIMESTAMP" || code === "TIMESTAMP_EXPIRED") && !this.clockSkewAttempt) {
          this.clockSkewAttempt = true;
          try {
            const result = await this.doRequest(query, variables);
            this.clockSkewAttempt = false;
            return result;
          } finally {
            this.clockSkewAttempt = false;
          }
        }
        throw new ShopeeApiError("auth_failure", code ?? `Shopee ${res.status}`);
      }
      const body: any = await res.json();
      if (Array.isArray(body?.errors) && body.errors.length > 0) {
        outcome = "error_4xx";
        const code = body.errors[0]?.extensions?.code ?? "unknown";
        throw new ShopeeApiError(code === "RATE_LIMIT" ? "rate_limit" : "unknown", JSON.stringify(body.errors[0]));
      }
      this.posthog.capture("shopee_api_call", {
        method: methodSlug,
        latency_ms: Date.now() - startedAt,
        status: "success",
      });
      return body.data;
    } catch (e) {
      if ((e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError") {
        outcome = "timeout";
        this.sentry.captureMessage("Shopee API timeout", { level: "warning", tags: { fr: "FR-AFF-001", method: methodSlug } });
        throw new ShopeeApiError("service_unavailable", "timeout");
      }
      if (!(e instanceof ShopeeApiError)) {
        this.sentry.captureException(e, { tags: { fr: "FR-AFF-001", method: methodSlug, outcome } });
      }
      throw e;
    } finally {
      await recordApiOutcome(outcome === "success" ? "success" : outcome === "timeout" ? "timeout" : outcome === "error_429" ? "error_429" : outcome === "error_5xx" ? "error_5xx" : "error_4xx");
      this.posthog.capture("shopee_api_call", {
        method: methodSlug,
        latency_ms: Date.now() - startedAt,
        status: outcome,
      });
    }
  }
}
