---
id: FR-AFF-006
title: "TikTok Shop affiliate discovery client - open collaboration search + promotion links"
module: AFF
priority: SHOULD
status: draft
verify: T
phase: P3
milestone: "P3 - slice 1 - Multi-platform"
slice: 1
owner: "Senior Tech Lead"
created: 2026-05-18
related_frs:
  - FR-AFF-001
  - FR-AFF-003
  - FR-AFF-005
  - FR-OBS-001
  - FR-WORKER-002
depends_on:
  - FR-AFF-001
  - FR-AFF-003
  - FR-OBS-001
  - FR-WORKER-002
blocks:
  - FR-AFF-007 # placeholder - not yet specified
  - FR-AFF-008 # placeholder - not yet specified
effort_hours: 10
template: engineering-spec@1
new_files:
  - apps/api/src/affiliate/tiktok/client.ts
  - apps/api/src/affiliate/tiktok/sign.ts
  - apps/api/src/affiliate/tiktok/normalize.ts
  - apps/api/src/affiliate/tiktok/errors.ts
  - apps/api/src/affiliate/tiktok/rate-limit-guard.ts
  - apps/api/src/affiliate/tiktok/circuit-breaker.ts
  - apps/api/src/affiliate/tiktok/types.ts
  - apps/api/src/affiliate/tiktok/__tests__/client.spec.ts
  - apps/api/src/affiliate/tiktok/__tests__/normalize.spec.ts
modified_files:
  - apps/api/src/affiliate/affiliate.module.ts
allowed_tools:
  - file_read/write apps/api/**
  - bash pnpm test
disallowed_tools:
  - scrape TikTok Shop pages or creator profiles when the API is unavailable
  - try to programmatically create or moderate creator onboarding flows (explicitly unsupported by the docs)
  - call undocumented/private TikTok Shop endpoints
  - log raw TikTok Shop payloads or secrets
  - bypass the circuit breaker to keep retrying
risk_if_skipped: "P3 multi-platform expansion would still be constrained to Shopee + Lazada, leaving TikTok Shop's public affiliate channel unused and delaying the second marketplace proof for the roadmap."
---

## §1 - Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The API service MUST expose a TikTok Shop affiliate discovery client that mirrors the hardened provider pattern already used for Shopee and Lazada.

1. The service MUST expose `TikTokShopAffiliateClient` from `apps/api/src/affiliate/tiktok/client.ts` and register it in `AffiliateModule` so future P3 consumers can inject it without touching controller code.
2. The client MUST expose `searchOpenCollaborationProducts(input: { keyword?: string; categoryIds?: string[]; commissionRateMin?: number; page?: number; pageSize?: number }): Promise<TikTokShopNormalizedOffer[]>` that searches only products available through the public TikTok Shop affiliate/open-collaboration surface.
3. The client MUST expose `generatePromotionLink(input: { productId: string }): Promise<TikTokShopPromotionLink>` that returns the affiliate promotion/deep link for a product already surfaced by the search flow.
4. Requests MUST go through the official TikTok Shop Affiliate APIs from config. HTML scraping, profile scraping, and undocumented/private endpoints are forbidden. The exact endpoint path and signing envelope MUST be isolated behind `sign.ts` and the client so no downstream caller hardcodes provider details.
5. All authenticated requests MUST be signed through `sign.ts`, and credential loading MUST come from `ConfigService`. Secrets MUST NOT be logged, echoed, or embedded into thrown error messages.
6. The client MUST apply provider-specific rate limiting and a circuit breaker. It MUST use a Redis-backed shared token bucket keyed `tiktokshop:rl:global`, default to `TIKTOK_SHOP_RATE_LIMIT_PER_MIN=1000`, and reuse the Shopee breaker thresholds unless TikTok Shop documents a stricter budget.
7. The client MUST emit PostHog `affiliate_api_call` and Sentry breadcrumb/exception events with `platform`, `operation`, `latency_ms`, `status`, `error_code`, and `outcome` (`live|dead|error`) when relevant.
8. The client MUST return an empty result set when no open-collaboration products match and MUST return a typed unavailable-item outcome when the provider says the product or promotion link is unavailable.
9. The client MUST NOT attempt programmatic creator onboarding or moderation. Creator authorization is separate from TikTok for Business and TikTok for Developers and is out of scope for this FR.
10. The client MUST fail closed for unsupported markets. If the configured region is UK or EU, the client MUST throw or return `unsupported_market` rather than attempting an outbound request.
11. The normalized offer MUST set `commissionRate` to a number when the provider returns it, otherwise `null`. The client MUST NOT fabricate commission data.
12. The normalized offer MUST expose `platform: "tiktok_shop"` and a collision-safe `platformProductId` so the adapter can stay isolated from later storage-schema work.

## §2 - Why this design

TikTok Shop's public affiliate APIs are now a documented path for developers, and the partner center explicitly describes affiliate seller, creator, and partner APIs. The launch material also calls out the capabilities most relevant to SaleNoti's P3 expansion: search products with open collaborations by category, commission rate, and keywords, plus generate affiliate product promotion links.

This FR deliberately scopes to discovery and link generation instead of creator onboarding. The docs state that external partners cannot currently facilitate or moderate creator onboarding programmatically, and creator authorization is separate from TikTok for Business / TikTok for Developers. Treating that as a hard boundary keeps the spec honest and avoids promising a flow the platform does not expose.

The search-plus-link pair is still valuable for SaleNoti because it creates a second public marketplace adapter with the same hardening pattern as Shopee and Lazada. That gives the roadmap a real multi-platform proof without requiring a separate watcher, price-history schema migration, or mobile UI change in the same FR.

The provider contract is intentionally isolated: `sign.ts` owns request signing, the client owns transport, and the caller never sees endpoint or header details. That keeps future TikTok Shop docs or auth-envelope changes local to one adapter file and avoids leaking vendor specifics into downstream code.

## §3 - API contract and code shape

### Files

- `apps/api/src/affiliate/tiktok/client.ts`
- `apps/api/src/affiliate/tiktok/sign.ts`
- `apps/api/src/affiliate/tiktok/normalize.ts`
- `apps/api/src/affiliate/tiktok/errors.ts`
- `apps/api/src/affiliate/tiktok/rate-limit-guard.ts`
- `apps/api/src/affiliate/tiktok/circuit-breaker.ts`
- `apps/api/src/affiliate/tiktok/types.ts`
- `apps/api/src/affiliate/affiliate.module.ts`

### Environment

- `TIKTOK_SHOP_AFFILIATE_BASE_URL`
- `TIKTOK_SHOP_AFFILIATE_APP_KEY`
- `TIKTOK_SHOP_AFFILIATE_APP_SECRET`
- `TIKTOK_SHOP_AFFILIATE_ACCESS_TOKEN`
- `TIKTOK_SHOP_REGION`
- `TIKTOK_SHOP_RATE_LIMIT_PER_MIN`
- `TIKTOK_SHOP_REQUEST_TIMEOUT_MS`

### Core types

```ts
export interface TikTokShopNormalizedOffer {
  platform: "tiktok_shop";
  platformProductId: string;
  productId: string;
  title: string;
  currentPrice: number;
  originalPrice: number;
  discountPct: number;
  imageUrl: string | null;
  commissionRate: number | null;
  currency: "VND";
  openCollaboration: boolean;
}

export interface TikTokShopPromotionLink {
  productId: string;
  platformProductId: string;
  promotionLink: string;
  generatedAt: string;
}

export interface TikTokShopSearchInput {
  keyword?: string;
  categoryIds?: string[];
  commissionRateMin?: number;
  page?: number;
  pageSize?: number;
}

export type TikTokShopApiErrorCode =
  | "config_error"
  | "auth_failure"
  | "rate_limit"
  | "unsupported_market"
  | "service_unavailable"
  | "schema_drift"
  | "no_results"
  | "unknown";

export class TikTokShopApiError extends Error {
  constructor(public readonly code: TikTokShopApiErrorCode, message?: string) {
    super(message ?? `TikTok Shop API error: ${code}`);
  }
}

export function normalizeTikTokShopProduct(input: {
  productId: string;
  title: string;
  price: number;
  originalPrice?: number | null;
  imageUrl?: string | null;
  commissionRate?: number | null;
  openCollaboration: boolean;
}): TikTokShopNormalizedOffer;
```

### Service shape

```ts
@Injectable()
export class TikTokShopAffiliateClient {
  async searchOpenCollaborationProducts(input: TikTokShopSearchInput): Promise<TikTokShopNormalizedOffer[]>;
  async generatePromotionLink(input: { productId: string }): Promise<TikTokShopPromotionLink>;
}
```

The client MAY expose additional helpers internally, but the public surface for this FR is discovery plus promotion-link generation.

## §4 - Acceptance criteria

1. Given a valid TikTok Shop Partner Center sandbox app and an open-collaboration fixture, `searchOpenCollaborationProducts()` returns normalized offers with `platform: "tiktok_shop"` and collision-safe `platformProductId` values.
2. Given a product outside open collaboration, `searchOpenCollaborationProducts()` returns an empty array rather than fabricating availability.
3. Given a valid product ID from search results, `generatePromotionLink()` returns a deterministic promotion link that the UI can render without a second round-trip.
4. Given missing credentials, the client fails fast with a typed configuration error and no outbound network call.
5. Given `TIKTOK_SHOP_REGION=UK` or `EU`, the client returns or throws `unsupported_market` and never attempts provider calls.
6. Given repeated `429` or `5xx` responses, the breaker opens after the configured threshold and the next call short-circuits locally.
7. Given `TIKTOK_SHOP_RATE_LIMIT_PER_MIN=1`, the second call in the same minute is delayed or rejected according to the guard, not allowed to burst.
8. Given a stable provider mock fixture, p95 round-trip time stays below 1500 ms across 50 sequential calls.
9. `AffiliateModule` compiles with `TikTokShopAffiliateClient` exported for future P3 consumers.
10. No log, Sentry event, or PostHog event contains the raw TikTok Shop payload, creator-authorization secret, or access token.
11. The client never attempts programmatic creator onboarding or moderation.

## §5 - Verification

```ts
// apps/api/src/affiliate/tiktok/__tests__/normalize.spec.ts
it("normalizes TikTok Shop affiliate products", () => {
  const offer = normalizeTikTokShopProduct({
    productId: "987654321",
    title: "Ao khoac mua he",
    price: 199000,
    originalPrice: 299000,
    imageUrl: "https://img.example/tiktokshop.jpg",
    commissionRate: 10,
    openCollaboration: true,
  });

  expect(offer).toMatchObject({
    platform: "tiktok_shop",
    platformProductId: "tiktok_shop:987654321",
    currentPrice: 199000,
    originalPrice: 299000,
    discountPct: 33,
    commissionRate: 10,
    openCollaboration: true,
  });
});
```

```ts
// apps/api/src/affiliate/tiktok/__tests__/client.spec.ts
it("returns no results for non-open collaboration products", async () => {
  mockFetch.sequence([200]);
  const results = await client.searchOpenCollaborationProducts({ keyword: "test" });
  expect(results).toEqual([]);
});
```

```ts
it("generates a promotion link for a selected product", async () => {
  const link = await client.generatePromotionLink({ productId: "987654321" });
  expect(link.promotionLink).toContain("http");
  expect(link.platformProductId).toBe("tiktok_shop:987654321");
});
```

```ts
it("throws unsupported_market for UK/EU regions", async () => {
  cfg.getOrThrow.mockImplementation((key: string) => {
    if (key === "TIKTOK_SHOP_REGION") return "UK";
    return "value";
  });

  await expect(client.searchOpenCollaborationProducts({ keyword: "ao thun" })).rejects.toMatchObject({ code: "unsupported_market" });
});
```

## §6 - Implementation skeleton

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TikTokShopApiError } from "./errors";
import { normalizeTikTokShopProduct } from "./normalize";
import { TikTokShopRateLimitGuard } from "./rate-limit-guard";

export function buildTikTokShopHeaders(payload: string, appKey: string, appSecret: string, accessToken: string, now = Date.now()) {
  void payload;
  void appKey;
  void appSecret;
  void accessToken;
  void now;
  return { headers: {} };
}

@Injectable()
export class TikTokShopAffiliateClient {
  private readonly log = new Logger(TikTokShopAffiliateClient.name);

  constructor(private readonly cfg: ConfigService, private readonly rateLimit: TikTokShopRateLimitGuard) {}

  async searchOpenCollaborationProducts(input: { keyword?: string; categoryIds?: string[]; commissionRateMin?: number; page?: number; pageSize?: number }) {
    const region = this.cfg.getOrThrow("TIKTOK_SHOP_REGION");
    if (region === "UK" || region === "EU") throw new TikTokShopApiError("unsupported_market");
    await this.rateLimit.acquire();

    const body = JSON.stringify(input);
    const { headers } = buildTikTokShopHeaders(
      body,
      this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_APP_KEY"),
      this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_APP_SECRET"),
      this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_ACCESS_TOKEN")
    );

    const response = await fetch(this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_BASE_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(Number(this.cfg.get("TIKTOK_SHOP_REQUEST_TIMEOUT_MS") ?? 10_000)),
    });

    if (response.status === 404) return [];
    if (response.status === 401 || response.status === 403) throw new TikTokShopApiError("auth_failure");
    if (response.status === 429) throw new TikTokShopApiError("rate_limit");
    if (response.status >= 500) throw new TikTokShopApiError("service_unavailable");

    const json = await response.json();
    const items = Array.isArray(json?.data?.products) ? json.data.products : [];
    return items.map(normalizeTikTokShopProduct);
  }

  async generatePromotionLink(input: { productId: string }) {
    const region = this.cfg.getOrThrow("TIKTOK_SHOP_REGION");
    if (region === "UK" || region === "EU") throw new TikTokShopApiError("unsupported_market");
    await this.rateLimit.acquire();
    const body = JSON.stringify(input);
    const { headers } = buildTikTokShopHeaders(
      body,
      this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_APP_KEY"),
      this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_APP_SECRET"),
      this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_ACCESS_TOKEN")
    );

    const response = await fetch(this.cfg.getOrThrow("TIKTOK_SHOP_AFFILIATE_BASE_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(Number(this.cfg.get("TIKTOK_SHOP_REQUEST_TIMEOUT_MS") ?? 10_000)),
    });

    if (response.status === 404) throw new TikTokShopApiError("no_results");
    if (response.status === 401 || response.status === 403) throw new TikTokShopApiError("auth_failure");
    if (response.status === 429) throw new TikTokShopApiError("rate_limit");
    if (response.status >= 500) throw new TikTokShopApiError("service_unavailable");

    const json = await response.json();
    const promotionLink = json?.data?.promotionLink;
    if (!promotionLink) throw new TikTokShopApiError("schema_drift");

    return {
      productId: input.productId,
      platformProductId: `tiktok_shop:${input.productId}`,
      promotionLink,
      generatedAt: new Date().toISOString(),
    };
  }
}
```

## §7 - Dependencies

External dependencies:

- TikTok Shop Partner Center app registration and affiliate API access.
- TikTok Shop docs for the seller/partner affiliate surfaces.
- Redis for the provider-specific token bucket.
- PostHog and Sentry for request telemetry.
- Region access that excludes UK/EU, per the partner docs note.

Internal dependencies:

- `FR-AFF-001` for the hardened client pattern.
- `FR-AFF-003` for normalized offer semantics and failure hygiene.
- `FR-AFF-005` for the sibling P3 provider-client pattern.
- `FR-OBS-001` for tracing and PII-safe logging.
- `FR-WORKER-002` for shared backoff and rate-limit policy.

## §8 - Example payloads

### Example search request

```json
{
  "keyword": "ao thun",
  "categoryIds": ["1234"],
  "commissionRateMin": 8,
  "page": 1,
  "pageSize": 20
}
```

### Example search response item

```json
{
  "productId": "987654321",
  "title": "Ao khoac mua he",
  "price": 199000,
  "originalPrice": 299000,
  "imageUrl": "https://img.example/tiktokshop.jpg",
  "commissionRate": 10,
  "openCollaboration": true
}
```

### Example promotion link response

```json
{
  "productId": "987654321",
  "platformProductId": "tiktok_shop:987654321",
  "promotionLink": "https://vt.tiktok.com/abc123/",
  "generatedAt": "2026-05-18T10:00:00.000Z"
}
```

## §9 - Open questions

All resolved at authoring time:

1. The client accepts product discovery filters and promotion-link generation, not creator onboarding. Creator authorization remains a separate TikTok Shop flow and is not part of this FR.
2. The exact endpoint path and request-signing envelope are isolated in `sign.ts` plus the client so provider changes stay local.
3. The client only targets supported affiliate markets. UK/EU are hard-failed because the docs say the affiliate APIs are not available there.
4. `platformProductId` is an adapter identifier for this slice. A later FR will decide whether product and price storage gain a first-class `platform` column.
5. The search surface is limited to open-collaboration products with commission and keyword filters, because that is the public capability the docs explicitly surface.

## §10 - Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Credentials missing or misconfigured | `ConfigService.getOrThrow` fails | typed config error | fix env vars; retry after deploy |
| Signature/header mismatch | 401/403 from provider | auth failure | update `sign.ts` only; no caller change |
| Unsupported market | `TIKTOK_SHOP_REGION` is UK/EU | unsupported_market | use supported SEA/VN region |
| Provider outage | 5xx responses or timeout | breaker opens | short-circuit locally until half-open |
| Provider rate limit | 429 responses | request rejected or delayed | retry later through guard policy |
| No open-collaboration results | empty `data.products[]` | empty array | show no-results UI and refine query |
| Promotion link unavailable | `data.promotionLink` missing | `no_results` or schema drift | request a different product or refresh auth |
| Payload schema drift | normalization test fails or zod parse fails | request marked error | pin fixture and update mapper |
| Redis unavailable | guard cannot reserve token | request fails closed | surface infra alert and retry later |
| PostHog outage | telemetry capture throws | core request still succeeds | swallow telemetry failure after logging to Sentry |
| Sentry outage | breadcrumb/exception upload fails | core request still succeeds | keep client response path independent |
| Creator onboarding attempted | test sees onboarding API call | build fails / rejected flow | remove onboarding code; this FR does not support it |
| Raw payload leakage | log snapshot contains provider payload | compliance failure | remove payload logging and redact response fields |

## §11 - Notes

This FR is intentionally the second P3 marketplace slice only. It gives SaleNoti a public TikTok Shop affiliate discovery surface without committing to creator onboarding or a new persistence schema. That keeps the P3 multi-platform proof narrow enough to ship and aligns with the partner docs boundary between creator authorization and developer access.

Plan references: P3 roadmap boundary in `BACKLOG.md §5`, the public affiliate-API launch note from TikTok for Developers, and the partner-center affiliate overview that lists search, open-collaboration, and promotion-link capabilities.
