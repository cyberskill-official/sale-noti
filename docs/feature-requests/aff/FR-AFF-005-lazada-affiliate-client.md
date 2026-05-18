---
id: FR-AFF-005
title: "Lazada Affiliate client - normalized offer resolver for multi-platform tracking"
module: AFF
priority: MUST
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
  - FR-OBS-001
  - FR-WORKER-002
depends_on:
  - FR-AFF-001
  - FR-AFF-003
  - FR-OBS-001
  - FR-WORKER-002
blocks:
  - FR-AFF-006 # placeholder - not yet specified
  - FR-AFF-007 # placeholder - not yet specified
  - FR-AFF-008 # placeholder - not yet specified
effort_hours: 12
template: engineering-spec@1
new_files:
  - apps/api/src/affiliate/lazada/client.ts
  - apps/api/src/affiliate/lazada/sign.ts
  - apps/api/src/affiliate/lazada/normalize.ts
  - apps/api/src/affiliate/lazada/errors.ts
  - apps/api/src/affiliate/lazada/rate-limit-guard.ts
  - apps/api/src/affiliate/lazada/circuit-breaker.ts
  - apps/api/src/affiliate/lazada/types.ts
  - apps/api/src/affiliate/lazada/__tests__/client.spec.ts
  - apps/api/src/affiliate/lazada/__tests__/normalize.spec.ts
modified_files:
  - apps/api/src/affiliate/affiliate.module.ts
allowed_tools:
  - file_read/write apps/api/**
  - bash pnpm test
disallowed_tools:
  - scrape Lazada HTML pages when the API is unavailable
  - call private or undocumented Lazada endpoints
  - log raw Lazada payloads or secrets
  - bypass the circuit breaker to keep retrying
risk_if_skipped: "P3 multi-platform expansion cannot start on the Lazada side without a provider-grade client that mirrors the Shopee hardening pattern."
---

## §1 - Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The API service MUST expose a Lazada affiliate client that mirrors the hardening pattern already used for Shopee.

1. The service MUST expose `LazadaAffiliateClient` from `apps/api/src/affiliate/lazada/client.ts` and register it in `AffiliateModule` so future P3 consumers can inject it without touching controller code.
2. `productOffer(input: { shopId: number; itemId: number })` MUST return a normalized offer object with `platform: "lazada"` and `platformProductId: "lazada:<shopId>-<itemId>"`.
3. Requests MUST go through the official Lazada affiliate base URL from config. HTML scraping and undocumented/private endpoints are forbidden. The exact endpoint path and auth envelope MUST be isolated behind `sign.ts` and the client so no downstream caller hardcodes provider details.
4. All authenticated requests MUST be signed through `sign.ts`, and credential loading MUST come from `ConfigService`. Secrets MUST NOT be logged, echoed, or embedded into thrown error messages.
5. The client MUST apply provider-specific rate limiting and a circuit breaker. It MUST use a Redis-backed shared token bucket keyed `lazada:rl:global`, default to `LAZADA_RATE_LIMIT_PER_MIN=1000`, and reuse the Shopee breaker thresholds unless Lazada documents a stricter budget.
6. The client MUST emit PostHog `affiliate_api_call` and Sentry breadcrumb/exception events with `platform`, `operation`, `latency_ms`, `status`, `error_code`, and `outcome` (`live|dead|error`) when relevant.
7. The client MUST return `null` for dead, withdrawn, or otherwise unavailable items. This FR MUST NOT write product history or watchlist rows; those follow-on effects belong to later FRs.
8. The normalized offer MUST set `commissionRate` to a number when the provider returns it, otherwise `null`. The client MUST NOT fabricate commission data.
9. This FR MUST accept only `shopId` + `itemId` as input. URL normalization is out of scope and belongs to an upstream Lazada-aware resolver FR.

## §2 - Why this design

P3 in the roadmap is explicitly about Lazada, TikTok Shop, mobile, and B2B expansion. The Shopee client already proved the hardening pattern: a provider-local client, a rate-limit guard, a breaker, typed normalization, and observability hooks. Lazada should reuse the same shape so the codebase does not split into one-off marketplace code paths.

A provider-local client also keeps the first P3 slice atomic. This FR is about standing up a trustworthy Lazada adapter, not yet about changing every watchlist or history collection. That separation matters because the later platform-field work in the product and price schema is a separate concern and should be captured in a follow-up FR.

The design avoids scraping because the plan and PRD both treat official affiliate APIs as the only acceptable data path. That keeps us aligned with the trust/compliance moat already enforced in the shipped P0-P2 FRs.

`platformProductId` is included now so the adapter can stay collision-safe even before the shared storage layer grows a first-class `platform` column.

The provider contract is intentionally isolated: `sign.ts` owns request signing, the client owns transport, and the caller never sees endpoint or header details. That keeps future Lazada doc updates local to one adapter file and avoids a second provider-specific branch in downstream code.

## §3 - API contract and code shape

### Files

- `apps/api/src/affiliate/lazada/client.ts`
- `apps/api/src/affiliate/lazada/sign.ts`
- `apps/api/src/affiliate/lazada/normalize.ts`
- `apps/api/src/affiliate/lazada/errors.ts`
- `apps/api/src/affiliate/lazada/rate-limit-guard.ts`
- `apps/api/src/affiliate/lazada/circuit-breaker.ts`
- `apps/api/src/affiliate/lazada/types.ts`
- `apps/api/src/affiliate/affiliate.module.ts`

### Environment

- `LAZADA_AFFILIATE_BASE_URL`
- `LAZADA_AFFILIATE_APP_KEY`
- `LAZADA_AFFILIATE_APP_SECRET`
- `LAZADA_AFFILIATE_ACCESS_TOKEN`
- `LAZADA_RATE_LIMIT_PER_MIN`
- `LAZADA_REQUEST_TIMEOUT_MS`

### Core types

```ts
export interface LazadaNormalizedOffer {
  platform: "lazada";
  platformProductId: string;
  shopId: number;
  itemId: number;
  productName: string;
  currentPrice: number;
  originalPrice: number;
  discountPct: number;
  imageUrl: string | null;
  affiliateLink: string;
  commissionRate: number | null;
  currency: "VND";
  flashSale: boolean;
}

export interface LazadaProductOfferInput {
  shopId: number;
  itemId: number;
}

export type LazadaApiErrorCode = "config_error" | "auth_failure" | "rate_limit" | "service_unavailable" | "schema_drift" | "unknown";

export class LazadaApiError extends Error {
  constructor(public readonly code: LazadaApiErrorCode, message?: string) {
    super(message ?? `Lazada API error: ${code}`);
  }
}

export function normalizeLazadaOffer(input: {
  shopId: number;
  itemId: number;
  title: string;
  price: number;
  originalPrice?: number | null;
  imageUrl?: string | null;
  affiliateLink: string;
  commissionRate?: number | null;
}): LazadaNormalizedOffer;
```

### Service shape

```ts
@Injectable()
export class LazadaAffiliateClient {
  async productOffer(input: LazadaProductOfferInput): Promise<LazadaNormalizedOffer | null>;
}
```

The client MAY expose additional helpers internally, but the public surface for this FR is one normalized product-offer lookup.

## §4 - Acceptance criteria

1. Given a Lazada sandbox fixture and valid credentials, `productOffer({ shopId, itemId })` returns a normalized offer with `platform: "lazada"`, numeric price fields, and deterministic `platformProductId`.
2. Given a dead-item fixture, `productOffer()` returns `null` and emits a dead-item outcome event without writing product history.
3. Given missing credentials, the client fails fast with a typed configuration error and no outbound network call.
4. Given repeated `429` or `5xx` responses, the breaker opens after the configured threshold and the next call short-circuits locally.
5. Given a mock response missing commission information, the normalized offer returns `commissionRate: null` rather than a fabricated value.
6. Given `LAZADA_RATE_LIMIT_PER_MIN=1`, the second call in the same minute is delayed or rejected according to the guard, not allowed to burst.
7. Given a stable provider mock fixture, p95 round-trip time stays below 1500 ms across 50 sequential calls.
8. `AffiliateModule` compiles with `LazadaAffiliateClient` exported for future P3 consumers.
9. No log, Sentry event, or PostHog event contains the raw Lazada payload or secret material.
10. `productOffer()` accepts only `shopId` + `itemId`; any URL-normalization code lives outside this FR.

## §5 - Verification

```ts
// apps/api/src/affiliate/lazada/__tests__/normalize.spec.ts
it("normalizes lazada payloads", () => {
  const offer = normalizeLazadaOffer({
    shopId: 123,
    itemId: 456,
    title: "Ao thun basic",
    price: 89000,
    originalPrice: 129000,
    imageUrl: "https://img.example/lazada.jpg",
    affiliateLink: "https://lazada.vn/aff/abc",
    commissionRate: 7.5,
  });

  expect(offer).toMatchObject({
    platform: "lazada",
    platformProductId: "lazada:123-456",
    currentPrice: 89000,
    originalPrice: 129000,
    discountPct: 31,
    commissionRate: 7.5,
  });
});
```

```ts
// apps/api/src/affiliate/lazada/__tests__/client.spec.ts
it("opens the breaker after repeated 429s", async () => {
  mockFetch.sequence([429, 429, 429, 429, 429]);
  await expect(client.productOffer({ shopId: 123, itemId: 456 })).rejects.toThrow();
  await expect(client.productOffer({ shopId: 123, itemId: 456 })).rejects.toMatchObject({ code: "rate_limit" });
});
```

```ts
it("does not leak payloads into logs", async () => {
  await client.productOffer({ shopId: 123, itemId: 456 });
  expect(loggerSpy).not.toHaveBeenCalledWith(expect.stringContaining("affiliateLink"));
});
```

```ts
// apps/api/src/affiliate/lazada/__tests__/client.spec.ts
it("throws a typed config error before network calls when credentials are missing", async () => {
  cfg.getOrThrow.mockImplementation((key: string) => {
    if (key.startsWith("LAZADA_AFFILIATE_")) throw new LazadaApiError("config_error");
    return undefined;
  });

  await expect(client.productOffer({ shopId: 123, itemId: 456 })).rejects.toMatchObject({ code: "config_error" });
});
```

## §6 - Implementation skeleton

```ts
import crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LazadaApiError } from "./errors";
import { normalizeLazadaOffer } from "./normalize";
import { LazadaRateLimitGuard } from "./rate-limit-guard";

export function signLazadaRequest(payload: string, appKey: string, appSecret: string, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  const signature = crypto.createHash("sha256").update(`${appKey}:${timestamp}:${payload}:${appSecret}`).digest("hex");
  return { timestamp, signature, header: `LZSHA256 Credential=${appKey}, Signature=${signature}, Timestamp=${timestamp}` };
}

@Injectable()
export class LazadaAffiliateClient {
  private readonly log = new Logger(LazadaAffiliateClient.name);

  constructor(private readonly cfg: ConfigService, private readonly rateLimit: LazadaRateLimitGuard) {}

  async productOffer(input: { shopId: number; itemId: number }) {
    await this.rateLimit.acquire();
    const body = JSON.stringify({ shopId: input.shopId, itemId: input.itemId });
    const { header } = signLazadaRequest(body, this.cfg.getOrThrow("LAZADA_AFFILIATE_APP_KEY"), this.cfg.getOrThrow("LAZADA_AFFILIATE_APP_SECRET"));
    const response = await fetch(this.cfg.getOrThrow("LAZADA_AFFILIATE_BASE_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: header },
      body,
      signal: AbortSignal.timeout(Number(this.cfg.get("LAZADA_REQUEST_TIMEOUT_MS") ?? 10_000)),
    });
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) throw new LazadaApiError("auth_failure");
    if (response.status === 429) throw new LazadaApiError("rate_limit");
    if (response.status >= 500) throw new LazadaApiError("service_unavailable");
    const json = await response.json();
    if (!json?.data?.item) return null;
    return normalizeLazadaOffer(json.data.item);
  }
}
```

## §7 - Dependencies

External dependencies:

- Lazada affiliate sandbox or staging credentials.
- Redis for the provider-specific token bucket.
- PostHog and Sentry for request telemetry.
- The official Lazada affiliate API docs, especially the signing and response-schema sections.

Internal dependencies:

- `FR-AFF-001` for the hardened client pattern.
- `FR-AFF-003` for normalized offer semantics and dead-item handling.
- `FR-OBS-001` for tracing and PII-safe logging.
- `FR-WORKER-002` for shared backoff and rate-limit policy.

## §8 - Example payloads

### Example request

```json
{
  "shopId": 123456,
  "itemId": 987654321
}
```

### Example provider response

```json
{
  "data": {
    "item": {
      "shopId": 123456,
      "itemId": 987654321,
      "title": "Ao thun nam basic",
      "price": 89000,
      "originalPrice": 129000,
      "imageUrl": "https://img.example/lazada.jpg",
      "affiliateLink": "https://lazada.vn/aff/abc",
      "commissionRate": 7.5
    }
  }
}
```

### Example normalized offer

```json
{
  "platform": "lazada",
  "platformProductId": "lazada:123456-987654321",
  "shopId": 123456,
  "itemId": 987654321,
  "productName": "Ao thun nam basic",
  "currentPrice": 89000,
  "originalPrice": 129000,
  "discountPct": 31,
  "imageUrl": "https://img.example/lazada.jpg",
  "affiliateLink": "https://lazada.vn/aff/abc",
  "commissionRate": 7.5,
  "currency": "VND",
  "flashSale": false
}
```

## §9 - Open questions

All resolved at authoring time:

1. The client accepts only `shopId` + `itemId`. URL normalization belongs to an upstream Lazada-aware resolver and stays out of this FR.
2. The exact Lazada endpoint path and auth envelope are isolated in `sign.ts` plus the client; no downstream caller hardcodes them. Provider changes stay local to this adapter.
3. This slice normalizes product-level commission only. Shop-level commission, if Lazada exposes it, is a later P3/P4 concern and does not block this adapter.
4. `platformProductId` is an adapter identifier for this slice. A later FR will decide whether product and price storage gain a first-class `platform` column.
5. The rate-limit ceiling defaults to the shared Shopee-equivalent budget until provider docs say otherwise; the Redis key remains provider-specific (`lazada:rl:global`).

## §10 - Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Credentials missing or misconfigured | `ConfigService.getOrThrow` fails | typed config error | fix env vars; retry after deploy |
| Signature/header mismatch | 401/403 from provider | auth failure | update `sign.ts` only; no caller change |
| Invalid Lazada credentials | first outbound call 401/403 | typed auth error | fail fast and surface config gap |
| Provider outage | 5xx responses or timeout | breaker opens | short-circuit locally until half-open |
| Provider rate limit | 429 responses | request rejected or delayed | retry later through guard policy |
| Payload schema drift | normalization test fails or zod parse fails | request marked error | pin fixture and update mapper |
| Dead or withdrawn item | provider returns empty item | `null` result | caller can stop or retry later |
| Missing commission field | normalization step sees absent field | `commissionRate: null` | preserve source truth without fabrication |
| Redis unavailable | guard cannot reserve token | request fails closed | surface infra alert and retry later |
| PostHog outage | telemetry capture throws | core request still succeeds | swallow telemetry failure after logging to Sentry |
| Sentry outage | breadcrumb/exception upload fails | core request still succeeds | keep client response path independent |
| Unexpected currency format | parser cannot coerce price | normalization error | reject payload and keep no partial state |
| Provider returns no item payload | `json.data.item` absent | null result | treat as unavailable item and do not write downstream state |

## §11 - Notes

This FR is intentionally the first P3 Lazada slice only. It stands up a provider-grade client and normalized output shape, but it does not yet change user-facing watchlist routes or product persistence. Those follow-on changes belong to the later P3 FRs.

Plan references: P3 roadmap boundary in `BACKLOG.md §5`, multi-platform expansion in `PRD.md §11`, and the P2 re-batch trigger in `P2_AUDIT_SUMMARY.md §6`.
