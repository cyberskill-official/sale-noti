---
id: FR-AFF-007
title: "AccessTrade publisher fallback client - campaigns list + tracking links for Shopee outage failover"
module: AFF
priority: MUST
status: accepted
verify: T
phase: P3
milestone: "P3 - slice 2 - Fallback resilience"
slice: 2
owner: "Senior Tech Lead"
created: 2026-05-18
related_frs:
  - FR-AFF-001
  - FR-AFF-002
  - FR-LEGAL-002
  - FR-OBS-001
  - FR-WORKER-002
depends_on:
  - FR-AFF-001
  - FR-AFF-002
  - FR-LEGAL-002
  - FR-OBS-001
  - FR-WORKER-002
blocks: []
effort_hours: 10
template: engineering-spec@1
new_files:
  - apps/api/src/affiliate/accesstrade/client.ts
  - apps/api/src/affiliate/accesstrade/sign.ts
  - apps/api/src/affiliate/accesstrade/normalize.ts
  - apps/api/src/affiliate/accesstrade/errors.ts
  - apps/api/src/affiliate/accesstrade/rate-limit-guard.ts
  - apps/api/src/affiliate/accesstrade/circuit-breaker.ts
  - apps/api/src/affiliate/accesstrade/types.ts
  - apps/api/src/affiliate/accesstrade/fallback.service.ts
  - apps/api/src/affiliate/accesstrade/__tests__/client.spec.ts
  - apps/api/src/affiliate/accesstrade/__tests__/fallback.spec.ts
  - apps/api/src/affiliate/accesstrade/__tests__/sign.spec.ts
modified_files:
  - apps/api/src/affiliate/deeplink.service.ts
  - apps/api/src/affiliate/affiliate.module.ts
allowed_tools:
  - file_read/write apps/api/**
  - bash pnpm test
disallowed_tools:
  - scrape AccessTrade pages when the API is unavailable
  - call undocumented/private AccessTrade endpoints
  - log raw AccessTrade payloads, tracking URLs, or access keys
  - bypass the circuit breaker to keep retrying
  - override other publishers' attribution or ignore `respectOtherPublisher`
risk_if_skipped: "If Shopee short-link generation degrades or is rate-limited, affiliate-link generation will fail closed and every share-deal, alert, and extension surface loses monetization continuity until a manual hotfix is deployed."
---

## §1 - Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The API service MUST expose an AccessTrade publisher fallback path that preserves affiliate-link generation when the Shopee direct short-link path fails.

1. The service MUST expose `AccessTradePublisherClient` from `apps/api/src/affiliate/accesstrade/client.ts` and register it in `AffiliateModule` so future P3 consumers can inject it without touching controller code.
2. The client MUST expose `listCampaigns(input: { page?: number; limit?: number; approval?: "successful" | "all" }): Promise<AccessTradeCampaign[]>` that returns normalized campaign summaries for manual review and future merchant routing.
3. The client MUST expose `createTrackingLink(input: { campaignId: string; urls: string[]; utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; subIds?: { sub1?: string; sub2?: string; sub3?: string; sub4?: string } }): Promise<AccessTradeTrackingLink>` that generates a tracking link from the documented publisher API.
4. Requests MUST target the Vietnam publisher API surface documented at `https://api.accesstrade.vn/v1/campaigns` and `https://api.accesstrade.vn/v1/product_link/create`. Authentication MUST use `Authorization: Token <access_key>` with `Content-Type: application/json`. The global JWT-authenticated AccessTrade variant is out of scope for this FR.
5. All authenticated requests MUST load `ACCESSTRADE_ACCESS_KEY` from `ConfigService`. Secrets MUST NOT be logged, echoed, or embedded into thrown error messages, and the auth header construction MUST be isolated behind `sign.ts`.
6. The client MUST apply provider-specific rate limiting and a circuit breaker. It MUST use a Redis-backed shared token bucket keyed `accesstrade:rl:global`, default to `ACCESSTRADE_RATE_LIMIT_PER_MIN=1000`, and reuse the Shopee breaker thresholds unless AccessTrade documents a stricter budget.
7. The client MUST emit PostHog `affiliate_api_call` and Sentry breadcrumb/exception events with `platform`, `operation`, `latency_ms`, `status`, `error_code`, and `outcome` (`live|dead|error`) when relevant.
8. The normalization layer MUST strip HTML from exposed campaign text fields and MUST prefer `short_link` over `aff_link` when both are present. The client MUST NOT leak raw response HTML, tracking URLs, or unparsed notices into logs or events.
9. `DeeplinkService` MUST use the AccessTrade fallback only when the Shopee short-link path fails with `rate_limit`, `service_unavailable`, or breaker-open conditions and `ACCESSTRADE_FALLBACK_ENABLED=true`. Config errors, missing AccessTrade credentials, unsupported markets, and `respectOtherPublisher: true` MUST fail closed or return the raw origin URL as appropriate.
10. The fallback path MUST preserve the FR-AFF-002 attribution semantics by mapping `sub1 = userHash`, `sub2 = watchlistHash` (or `"0"` when the caller has no watchlist), `sub3 = source`, and `sub4 = campaign`; `utm_source = "salenoti"`, `utm_medium = "affiliate_fallback"`, `utm_campaign = campaign`, and `utm_content = source`. The mapping MUST be deterministic and MUST NOT override another publisher's cookie or attribution path.
11. The fallback path MUST use `ACCESSTRADE_DEFAULT_CAMPAIGN_ID` from config and MUST fail closed if that campaign is missing or the campaign list is empty.
12. The normalized campaign MUST expose stable summary fields only: `id`, `name`, `merchant`, `url`, `approval`, `scope`, `status`, and optional `cookieDuration`. The adapter MUST NOT fabricate commission data or expose unrelated HTML blobs.

## §2 - Why this design

AccessTrade's publisher API gives SaleNoti a documented fallback channel with two capabilities that matter here: campaign discovery and tracking-link creation. The support docs also show sub IDs as a first-class tracking surface, which means we can preserve attribution without inventing a custom URL shortener.

This FR deliberately scopes to the Vietnam publisher API because the docs show the Vietnamese endpoint and authentication format separately from the global JWT-based variant. That keeps the slice honest and avoids promising cross-country support before the P3 fallback path has shipped.

The fallback is valuable because it preserves affiliate-link continuity when Shopee throttles, rejects, or breaks. It gives the product a resilience path without changing the storage schema or forcing a new user flow: users still get a link, and the app can still observe the event.

The provider contract is intentionally isolated: `sign.ts` owns the AccessTrade auth header, the client owns transport, and `DeeplinkService` only decides when to try the fallback. That keeps future AccessTrade documentation changes local to one adapter file and avoids leaking vendor specifics into downstream code.

## §3 - API contract and code shape

### Files

- `apps/api/src/affiliate/accesstrade/client.ts`
- `apps/api/src/affiliate/accesstrade/sign.ts`
- `apps/api/src/affiliate/accesstrade/normalize.ts`
- `apps/api/src/affiliate/accesstrade/errors.ts`
- `apps/api/src/affiliate/accesstrade/rate-limit-guard.ts`
- `apps/api/src/affiliate/accesstrade/circuit-breaker.ts`
- `apps/api/src/affiliate/accesstrade/types.ts`
- `apps/api/src/affiliate/accesstrade/fallback.service.ts`
- `apps/api/src/affiliate/affiliate.module.ts`
- `apps/api/src/affiliate/deeplink.service.ts`

### Environment

- `ACCESSTRADE_BASE_URL`
- `ACCESSTRADE_ACCESS_KEY`
- `ACCESSTRADE_DEFAULT_CAMPAIGN_ID`
- `ACCESSTRADE_FALLBACK_ENABLED`
- `ACCESSTRADE_REGION`
- `ACCESSTRADE_RATE_LIMIT_PER_MIN`
- `ACCESSTRADE_REQUEST_TIMEOUT_MS`

### Core types

```ts
export interface AccessTradeCampaign {
  id: string;
  name: string;
  merchant: string;
  url: string;
  approval: "successful" | "pending" | "rejected" | string;
  scope: string | null;
  status: number;
  cookieDuration: number | null;
}

export interface AccessTradeTrackingLink {
  campaignId: string;
  originUrl: string;
  affiliateLink: string;
  shortLink: string | null;
  generatedAt: string;
}

export interface AccessTradeFallbackInput {
  originUrl: string;
  userId: string;
  source: string;
  watchlistId?: string;
  campaign?: string;
  respectOtherPublisher?: boolean;
}

export type AccessTradeApiErrorCode =
  | "config_error"
  | "auth_failure"
  | "rate_limit"
  | "unsupported_market"
  | "service_unavailable"
  | "schema_drift"
  | "no_results"
  | "unknown";

export class AccessTradeApiError extends Error {
  constructor(public readonly code: AccessTradeApiErrorCode, message?: string) {
    super(message ?? `AccessTrade API error: ${code}`);
  }
}
```

### Service shape

```ts
@Injectable()
export class AccessTradePublisherClient {
  async listCampaigns(input: { page?: number; limit?: number; approval?: "successful" | "all" }): Promise<AccessTradeCampaign[]>;
  async createTrackingLink(input: {
    campaignId: string;
    urls: string[];
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    subIds?: { sub1?: string; sub2?: string; sub3?: string; sub4?: string };
  }): Promise<AccessTradeTrackingLink>;
}

@Injectable()
export class AccessTradeFallbackService {
  async generateFallbackLink(input: AccessTradeFallbackInput): Promise<{ url: string; expiresAt: Date | null; cached: boolean }>;
}
```

The client MAY expose additional helpers internally, but the public surface for this FR is campaign discovery plus fallback tracking-link generation.

## §4 - Acceptance criteria

1. Given valid AccessTrade VN credentials and a configured default campaign, `createTrackingLink()` returns a normalized link object with `shortLink` preferred over `affiliateLink` when both are present.
2. Given Shopee `generateShortLink()` fails with breaker-open, rate-limit, or service_unavailable conditions, `DeeplinkService` returns an AccessTrade fallback link when `ACCESSTRADE_FALLBACK_ENABLED=true`.
3. Given `respectOtherPublisher: true`, the fallback path returns the raw origin URL and does not call AccessTrade.
4. Given missing AccessTrade credentials, missing `ACCESSTRADE_DEFAULT_CAMPAIGN_ID`, or `ACCESSTRADE_REGION` outside the VN publisher slice, the client fails closed and does not fabricate a link.
5. Given a campaign response containing HTML in descriptive fields, the normalized campaign strips the markup before it leaves the adapter boundary.
6. Given repeated `429` or `5xx` responses, the breaker opens after the configured threshold and the next call short-circuits locally.
7. Given `ACCESSTRADE_RATE_LIMIT_PER_MIN=1`, the second call in the same minute is delayed or rejected according to the guard, not allowed to burst.
8. Given a stable provider mock fixture, p95 round-trip time stays below 1500 ms across 50 sequential calls.
9. `AffiliateModule` compiles with `AccessTradePublisherClient` exported for future P3 consumers.
10. No log, Sentry event, or PostHog event contains the raw AccessTrade access key, tracking URL, or unparsed HTML payload.
11. The fallback path preserves the FR-AFF-002 attribution semantics and never overrides another publisher's cookie or click path.

## §5 - Verification

```ts
// apps/api/src/affiliate/accesstrade/__tests__/normalize.spec.ts
it("normalizes AccessTrade campaigns", () => {
  const campaign = normalizeAccessTradeCampaign({
    id: "5585194803623188142",
    name: "Citibank New",
    merchant: "citibank_new",
    url: "https://www.citibank.com.vn/vietnamese/form/uu-dai-mo-the-tin-dung/index.htm",
    approval: "successful",
    scope: "private",
    status: 1,
    cookieDuration: 30,
    descriptionHtml: "<p>Thời gian lưu cookie 30 ngày</p>",
  });

  expect(campaign).toMatchObject({
    id: "5585194803623188142",
    name: "Citibank New",
    merchant: "citibank_new",
    approval: "successful",
    cookieDuration: 30,
  });
});
```

```ts
// apps/api/src/affiliate/accesstrade/__tests__/client.spec.ts
it("creates a tracking link for the configured campaign", async () => {
  const link = await client.createTrackingLink({
    campaignId: "5585194803623188142",
    urls: ["https://merchant.example/product"],
    utmSource: "salenoti",
    utmMedium: "affiliate_fallback",
    utmCampaign: "default",
    utmContent: "share_deal",
    subIds: { sub1: "userhash", sub2: "watchhash", sub3: "share_deal", sub4: "default" },
  });

  expect(link.shortLink ?? link.affiliateLink).toContain("http");
  expect(link.campaignId).toBe("5585194803623188142");
});
```

```ts
it("lists approved campaigns without leaking HTML", async () => {
  const campaigns = await client.listCampaigns({ approval: "successful" });
  expect(campaigns[0]?.name).not.toContain("<p>");
});
```

```ts
// apps/api/src/affiliate/accesstrade/__tests__/fallback.spec.ts
it("falls back to AccessTrade after Shopee breaker-open", async () => {
  mockShopee.generateShortLink.mockRejectedValue(new Error("circuit_breaker_open"));
  const result = await fallback.generateFallbackLink({
    originUrl: "https://merchant.example/product",
    userId: "user-1",
    source: "share_deal",
  });

  expect(result.url).toContain("http");
});
```

## §6 - Implementation skeleton

```ts
// apps/api/src/affiliate/accesstrade/sign.ts
export function buildAccessTradeHeaders(accessKey: string) {
  return {
    headers: {
      Authorization: `Token ${accessKey}`,
      "Content-Type": "application/json",
    },
  };
}
```

```ts
// apps/api/src/affiliate/accesstrade/client.ts
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccessTradeApiError } from "./errors";
import { normalizeAccessTradeCampaign, normalizeAccessTradeTrackingLink } from "./normalize";
import { AccessTradeRateLimitGuard } from "./rate-limit-guard";
import { buildAccessTradeHeaders } from "./sign";

@Injectable()
export class AccessTradePublisherClient {
  constructor(private readonly cfg: ConfigService, private readonly rateLimit: AccessTradeRateLimitGuard) {}

  async listCampaigns(input: { page?: number; limit?: number; approval?: "successful" | "all" }) {
    await this.rateLimit.acquire();
    const response = await fetch(`${this.baseUrl()}/campaigns`, {
      method: "GET",
      headers: buildAccessTradeHeaders(this.accessKey()).headers,
      signal: AbortSignal.timeout(this.timeoutMs()),
    });

    if (response.status === 401 || response.status === 403) throw new AccessTradeApiError("auth_failure");
    if (response.status === 429) throw new AccessTradeApiError("rate_limit");
    if (response.status >= 500) throw new AccessTradeApiError("service_unavailable");

    const json = await response.json();
    return (Array.isArray(json?.data) ? json.data : []).map(normalizeAccessTradeCampaign);
  }

  async createTrackingLink(input: {
    campaignId: string;
    urls: string[];
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    subIds?: { sub1?: string; sub2?: string; sub3?: string; sub4?: string };
  }) {
    await this.rateLimit.acquire();
    const response = await fetch(`${this.baseUrl()}/product_link/create`, {
      method: "POST",
      headers: buildAccessTradeHeaders(this.accessKey()).headers,
      body: JSON.stringify({
        campaign_id: input.campaignId,
        urls: input.urls,
        url_enc: true,
        utm_source: input.utmSource,
        utm_medium: input.utmMedium,
        utm_campaign: input.utmCampaign,
        utm_content: input.utmContent,
        sub1: input.subIds?.sub1,
        sub2: input.subIds?.sub2,
        sub3: input.subIds?.sub3,
        sub4: input.subIds?.sub4,
      }),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });

    if (response.status === 401 || response.status === 403) throw new AccessTradeApiError("auth_failure");
    if (response.status === 429) throw new AccessTradeApiError("rate_limit");
    if (response.status >= 500) throw new AccessTradeApiError("service_unavailable");

    const json = await response.json();
    return normalizeAccessTradeTrackingLink(json, input.campaignId);
  }

  private baseUrl(): string {
    return this.cfg.getOrThrow<string>("ACCESSTRADE_BASE_URL") ?? "https://api.accesstrade.vn/v1";
  }

  private accessKey(): string {
    return this.cfg.getOrThrow<string>("ACCESSTRADE_ACCESS_KEY");
  }

  private timeoutMs(): number {
    return Number(this.cfg.get("ACCESSTRADE_REQUEST_TIMEOUT_MS") ?? 10_000);
  }
}
```

## §7 - Dependencies

External dependencies:

- AccessTrade VN publisher API access key.
- AccessTrade campaign approval for the fallback campaign(s).
- AccessTrade support docs for campaign and tracking-link behavior.

Internal dependencies:

- `FR-AFF-001` for the Shopee direct path and fallback trigger conditions.
- `FR-AFF-002` for attribution semantics and sub-id hygiene.
- `FR-LEGAL-002` for disclosure behavior and no cookie override.
- `FR-OBS-001` for tracing and PII-safe logging.
- `FR-WORKER-002` for shared backoff and rate-limit policy.

## §8 - Example payloads

### Example campaign response

```json
{
  "data": [
    {
      "approval": "successful",
      "id": "5585194803623188142",
      "merchant": "citibank_new",
      "name": "Citibank New",
      "scope": "private",
      "status": 1,
      "url": "https://www.citibank.com.vn/vietnamese/form/uu-dai-mo-the-tin-dung/index.htm"
    }
  ]
}
```

### Example tracking link request

```json
{
  "campaign_id": "5585194803623188142",
  "urls": ["https://merchant.example/product"],
  "utm_source": "salenoti",
  "url_enc": true,
  "utm_medium": "affiliate_fallback",
  "utm_campaign": "default",
  "utm_content": "share-deal",
  "sub1": "userhash",
  "sub2": "watchhash",
  "sub3": "share_deal",
  "sub4": "default"
}
```

### Example tracking link response

```json
{
  "success": true,
  "data": {
    "error_link": [],
    "success_link": [
      {
        "aff_link": "https://tracking.dev.accesstrade.me/deep_link/123/456?utm_campaign=default&sub1=salenoti",
        "first_link": null,
        "short_link": "https://shorten.dev.accesstrade.me/ujrBHxpc",
        "url_origin": "https://merchant.example/product"
      }
    ],
    "suspend_url": []
  }
}
```

## §9 - Open questions

All resolved at authoring time:

1. The client targets the Vietnam publisher API only. The global JWT-authenticated AccessTrade variant is intentionally deferred.
2. Fallback uses one configured `ACCESSTRADE_DEFAULT_CAMPAIGN_ID` rather than automatic campaign matching, because the feature needs deterministic behavior before later merchant-routing work lands.
3. `short_link` is preferred when present; `aff_link` is the deterministic fallback.
4. The fallback path preserves FR-AFF-002 attribution semantics by mapping `sub1 = userHash`, `sub2 = watchlistHash` (or `"0"` when no watchlist is supplied), `sub3 = source`, and `sub4 = campaign`; `utm_source = "salenoti"`, `utm_medium = "affiliate_fallback"`, `utm_campaign = campaign`, and `utm_content = source`.
5. The fallback is only invoked when Shopee fails for provider outage, rate limit, or breaker-open conditions; config and region errors still fail closed.

## §10 - Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Access key missing | `ConfigService.getOrThrow` fails | typed config error | fix env vars; retry after deploy |
| Default campaign missing | `ACCESSTRADE_DEFAULT_CAMPAIGN_ID` absent or empty | config_error | set the campaign id and redeploy |
| Unsupported market | `ACCESSTRADE_REGION` outside VN | unsupported_market | stay on the VN publisher slice or add a later FR |
| Campaign list empty | `data[]` is empty or no approved campaigns | no_results | choose an approved campaign and retry |
| Auth failure | 401/403 from provider | auth_failure | rotate AccessTrade access key |
| Provider rate limit | 429 responses | request rejected or delayed | retry later through guard policy |
| Provider outage | 5xx responses or timeout | breaker opens | short-circuit locally until half-open |
| HTML schema drift | normalization test fails | request marked error | update normalizer only; no caller change |
| No short link returned | `short_link` missing and `aff_link` missing | schema_drift | update response mapping or provider config |
| Shopee path still healthy | fallback not invoked | normal Shopee path continues | no action needed |
| Other publisher cookie respected | `respectOtherPublisher=true` | raw origin URL returned | do not fallback or overwrite attribution |

---

*End of FR-AFF-007 draft. AccessTrade fallback is scoped to the VN publisher API and the DeeplinkService failover path.*
