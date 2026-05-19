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
import { backoffMs } from "../../scheduler/backoff-policy";

const ENDPOINT = "https://open-api.affiliate.shopee.vn/graphql";
const TIMEOUT_MS = 10_000;
const MAX_INTERNAL_RETRIES = 3;
type ShopeeOutcome = "success" | "error_429" | "error_5xx" | "error_4xx" | "timeout";

@Injectable()
export class ShopeeAffiliateClient {
  private readonly log = new Logger(ShopeeAffiliateClient.name);
  private readonly breaker = new CircuitBreaker();
  private clockSkewAttempt = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly rateLimit: ShopeeRateLimitGuard,
    @Inject("OBS_SENTRY") private readonly sentry: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
  ) {}

  async productOfferV2(input: { itemId: number | string; shopId: number | string }): Promise<ProductOfferNode | null> {
    const itemId = this.formatShopeeId(input.itemId, "itemId");
    const shopId = this.formatShopeeId(input.shopId, "shopId");
    const query = `query { productOfferV2(itemId: ${itemId}, shopId: ${shopId}) { nodes { itemId shopId productName priceMin priceMax productLink commissionRate sales imageUrl stock flashSale } } }`;
    const data = await this.call(query);
    const parsed = this.parseSafe(ProductOfferV2Response, data);
    return parsed.productOfferV2.nodes[0] ?? null;
  }

  async shopOfferV2(input: { shopId: number | string }): Promise<{ shopId: string; commissionRate: number } | null> {
    const shopId = this.formatShopeeId(input.shopId, "shopId");
    const query = `query { shopOfferV2(shopId: ${shopId}) { nodes { shopId commissionRate shopType } } }`;
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
    const pageNumber = Math.max(1, Math.floor(input.pageNumber ?? 1));
    const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize ?? 10)), 20);
    const sort = input.sort ?? "RELEVANCY";
    const safeKw = JSON.stringify(input.keyword);
    const query = `query { productSearch(keyword: ${safeKw}, pageNumber: ${pageNumber}, pageSize: ${pageSize}, sort: "${sort}") { nodes { itemId shopId productName priceMin priceMax productLink commissionRate sales imageUrl } } }`;
    const data = await this.call(query);
    return this.parseSafe(ProductSearchResponse, data).productSearch;
  }

  async generateShortLink(input: { originUrl: string; subIds: string[] }): Promise<{ shortLink: string }> {
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

  private formatShopeeId(value: number | string, field: "itemId" | "shopId"): string {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw new ShopeeApiError("unknown", `invalid_${field}`);
    }
    return String(numeric);
  }

  private async call(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.cfg.get("SHOPEE_AFFILIATE_APP_ID") || !this.cfg.get("SHOPEE_AFFILIATE_APP_SECRET")) {
      // Dev-mode stub: surface a typed error so callers can mock.
      throw new ShopeeApiError("auth_failure", "SHOPEE_AFFILIATE_APP_ID/SECRET not set in this env");
    }

    try {
      return await this.breaker.exec(() => this.doRequestWithRetries(query, variables));
    } catch (e) {
      if (e instanceof BreakerOpenError) throw new ShopeeApiError("service_unavailable", "circuit_breaker_open");
      throw e;
    }
  }

  private async doRequestWithRetries(query: string, variables: Record<string, unknown>): Promise<unknown> {
    for (let retry = 0; ; retry++) {
      try {
        return await this.doRequestOnce(query, variables);
      } catch (e) {
        if (!(e instanceof ShopeeApiError) || !e.retryable || retry >= MAX_INTERNAL_RETRIES) throw e;
        await this.sleep(backoffMs(retry + 1));
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async doRequestOnce(query: string, variables: Record<string, unknown>): Promise<unknown> {
    await this.rateLimit.acquire();
    const payload = JSON.stringify({ query, variables });
    const appId = this.cfg.getOrThrow<string>("SHOPEE_AFFILIATE_APP_ID");
    const appSecret = this.cfg.getOrThrow<string>("SHOPEE_AFFILIATE_APP_SECRET");
    const { header } = signRequest(payload, appId, appSecret);
    const startedAt = Date.now();
    let outcome: ShopeeOutcome = "success";
    const methodSlug = this.methodSlug(query);

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json", Authorization: header },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429) {
        outcome = "error_429";
        throw new ShopeeApiError("rate_limit", "Shopee rate limit", true);
      }
      if (res.status >= 500) {
        outcome = "error_5xx";
        throw new ShopeeApiError("service_unavailable", `Shopee ${res.status}`, true);
      }
      if (res.status >= 400) {
        outcome = "error_4xx";
        // FR-AFF-001 §1 #12 — clock-skew recovery: retry once with fresh timestamp.
        const body: any = await res.json().catch(() => ({}));
        const code = body?.errors?.[0]?.extensions?.code;
        if ((code === "INVALID_TIMESTAMP" || code === "TIMESTAMP_EXPIRED") && !this.clockSkewAttempt) {
          this.clockSkewAttempt = true;
          try {
            const result = await this.doRequestOnce(query, variables);
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
        const mapped = this.mapGraphqlErrorCode(code);
        outcome = mapped === "rate_limit" ? "error_429" : mapped === "service_unavailable" ? "error_5xx" : "error_4xx";
        throw new ShopeeApiError(
          mapped,
          `Shopee GraphQL error: ${code}`,
          mapped === "rate_limit" || mapped === "service_unavailable",
        );
      }
      return body.data;
    } catch (e) {
      if ((e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError") {
        outcome = "timeout";
        this.sentry.captureMessage("Shopee API timeout", {
          level: "warning",
          tags: { fr: "FR-AFF-001", method: methodSlug },
        });
        throw new ShopeeApiError("service_unavailable", "timeout");
      }
      if (!(e instanceof ShopeeApiError)) {
        this.sentry.captureException(e, { tags: { fr: "FR-AFF-001", method: methodSlug, outcome } });
      }
      throw e;
    } finally {
      await this.recordOutcome(outcome);
      this.addBreadcrumb(outcome === "success" ? "shopee.api.success" : "shopee.api.failure", {
        method: methodSlug,
        latency_ms: Date.now() - startedAt,
        status: outcome,
      });
      this.posthog.capture("shopee_api_call", {
        method: methodSlug,
        latency_ms: Date.now() - startedAt,
        status: outcome,
      });
    }
  }

  private methodSlug(query: string): string {
    return query.match(/\b(productOfferV2|shopOfferV2|productSearch|generateShortLink)\b/)?.[1] ?? "unknown";
  }

  private mapGraphqlErrorCode(code: unknown): "rate_limit" | "service_unavailable" | "auth_failure" | "unknown" {
    const normalized = String(code ?? "").toUpperCase();
    if (normalized.includes("RATE_LIMIT") || normalized.includes("TOO_MANY")) return "rate_limit";
    if (normalized.includes("INTERNAL") || normalized.includes("SERVER") || normalized.includes("UNAVAILABLE"))
      return "service_unavailable";
    if (
      normalized.includes("AUTH") ||
      normalized.includes("SIGNATURE") ||
      normalized.includes("UNAUTHORIZED") ||
      normalized.includes("FORBIDDEN") ||
      normalized.includes("TIMESTAMP")
    ) {
      return "auth_failure";
    }
    return "unknown";
  }

  private async recordOutcome(outcome: ShopeeOutcome): Promise<void> {
    try {
      await recordApiOutcome(outcome);
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-001", kind: "health_metric_write" } });
    }
  }

  private addBreadcrumb(category: string, data: Record<string, unknown>): void {
    this.sentry.addBreadcrumb?.({
      category,
      level: category.endsWith("success") ? "info" : "warning",
      data,
    });
  }
}
