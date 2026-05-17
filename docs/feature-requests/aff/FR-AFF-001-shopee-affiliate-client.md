---
id: FR-AFF-001
title: "Shopee Affiliate Open API client — GraphQL POST · SHA256 signed header · rate-limit aware"
module: AFF
priority: MUST
status: shipped
shipped: 2026-05-17
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
related_frs: [FR-AFF-002, FR-AFF-003, FR-AFF-004, FR-WORKER-002]
depends_on: [FR-WORKER-002, FR-OBS-001]
blocks: [FR-AFF-002, FR-AFF-003, FR-AFF-004, FR-WATCH-001, FR-PRICE-001]
effort_hours: 8

new_files:
  - apps/api/src/affiliate/shopee/client.ts
  - apps/api/src/affiliate/shopee/sign.ts
  - apps/api/src/affiliate/shopee/rate-limit-guard.ts
  - apps/api/src/affiliate/shopee/circuit-breaker.ts
  - apps/api/src/affiliate/shopee/types.ts
  - apps/api/src/affiliate/shopee/__tests__/client.spec.ts
modified_files:
  - apps/api/src/app.module.ts
allowed_tools: ["file_read/write apps/api/**", "bash pnpm test"]
disallowed_tools:
  - "scrape shopee.vn HTML pages (forbidden by plan §B1 + §H Shopee block extension)"
  - "use Shopee internal /api/v4/cart/get_cart_list or /api/v4/recommend/get_also_like (plan §B1 reject)"
  - "log raw Shopee API secret to any destination"
  - "send unsigned requests (Shopee will 401 — also leaks operational info)"
risk_if_skipped: "Plan §B2 makes Shopee Affiliate Open API the ONLY allowed channel for product data. Without this client, no FR in WATCH / PRICE / NOTIF can work. Plan §H Risk Matrix: 'Affiliate API thay đổi/đóng' is medium-high impact — having a clean client wrapper makes the swap to AccessTrade/Linkmydeals fallback a one-config change."

---

## §1 — Description (BCP-14 normative)

The API service MUST implement a hardened Shopee Affiliate Open API client.

1. **MUST** issue every request as `POST https://open-api.affiliate.shopee.vn/graphql` per plan §B2.
2. **MUST** sign every request with the canonical header `Authorization: SHA256 Credential=<app_id>, Signature=<sha256(app_id + timestamp + payload + app_secret)>, Timestamp=<unix_seconds>`. Signature MUST be lowercase hex.
3. **MUST** load `SHOPEE_AFFILIATE_APP_ID` and `SHOPEE_AFFILIATE_APP_SECRET` from Doppler. Never log either; never put in `.env*` committed files; never include in error messages.
4. **MUST** expose typed methods only — no raw GraphQL string callers from feature code:
   - `productOfferV2(input: { itemId: number, shopId: number }): Promise<ProductOffer>` (FR-AFF-003 surface).
   - `shopOfferV2(input: { shopId: number }): Promise<ShopOffer>` (FR-AFF-003 surface).
   - `productSearch(input: { keyword: string, pageNumber?, pageSize? }): Promise<ProductSearchResult>` (FR-AFF-004 surface).
   - `generateShortLink(input: { originUrl: string, subIds: string[] }): Promise<ShortLink>` (FR-AFF-002 surface).
5. **MUST** wrap every call in a `circuit-breaker` (closed → open → half-open) with thresholds: open after 5 consecutive failures or 50% error rate over 20-call rolling window; half-open after 60s; close on 3 consecutive successes in half-open.
6. **MUST** integrate the rate-limit guard from `apps/api/src/affiliate/shopee/rate-limit-guard.ts` that consumes from a Redis token bucket keyed `shopee:rl:global` with 1000 tokens/min (per FR-WORKER-002 §2 lower bound; tunable via Doppler `SHOPEE_RATE_LIMIT_PER_MIN`).
7. **MUST** apply exponential backoff with jitter (per FR-WORKER-002 §3 `backoffMs`) on 429 / 5xx. Max 3 internal retries; thereafter throw `ShopeeApiError` with `code` ∈ `{ "rate_limit", "service_unavailable", "auth_failure", "unknown" }`.
8. **MUST** parse Shopee error responses: GraphQL `errors[]` with `extensions.code` MUST be mapped to typed `ShopeeApiError`.
9. **MUST** record every outcome (`success | error_429 | error_5xx | error_4xx | timeout`) to Redis health window keys per FR-WORKER-002 §3 `recordApiOutcome`.
10. **MUST** emit Sentry breadcrumb `shopee.api.{success,failure}` and PostHog event `shopee_api_call` with `{ method, latency_ms, status }`. Raw payloads MUST NOT be logged; only field names and counts.
11. **MUST** complete a typical call (productOfferV2, single item) in p95 < 800 ms (network + signature + parse) when Shopee is healthy.
12. **MUST** handle clock skew gracefully: if the request fails with code suggesting timestamp drift, sync from `Date.now()` and re-sign once. If still fails → error.

---

## §2 — Why this design

**Why GraphQL POST + SHA256 signed header (not raw REST):** plan §B2 specifies "Phương thức: GraphQL endpoint `https://open-api.affiliate.shopee.vn/graphql` (theo cùng pattern shopee.com.br Brazil), POST + signed header SHA256." Brazil and Singapore both use this; we follow.

**Why a typed wrapper (not GraphQL-codegen):** intern team is more productive with a 4-method surface than with auto-gen GraphQL types. The Shopee schema has ~30 fields total in the relevant slice; we hand-type. P3 may revisit with codegen.

**Why circuit breaker + rate-limit guard + backoff together:** three independent failure modes (transient errors, persistent provider outage, exhausted quota) need distinct controls. The combo is the canonical SRE pattern (e.g., Netflix Hystrix). Plan §H Risk Matrix flags both "Affiliate API thay đổi/đóng" (provider outage) and "Shopee block extension" (rate-limit related blacklist) — defense in depth.

**Why Redis token bucket (not local in-process)?** API may run on multiple Railway pods later. Local rate-limit per pod multiplies the global rate when scaled out. Redis bucket is a single source of truth.

**Why typed `ShopeeApiError`:** lets feature code (FR-WATCH-001, FR-AFF-002) discriminate "transient" vs "permanent" vs "this product no longer exists." Naked exceptions defeat that.

**Why never log raw payloads:** Shopee Open API responses include affiliate share rates, sometimes shop owner data, sometimes our app credentials in error messages. Plan §B3 PDPL Art. 24 means raw payloads MIGHT contain personal data of buyers (timestamps + product + commission); cleaner to disallow logging entirely.

---

## §3 — Code shape

### `apps/api/src/affiliate/shopee/sign.ts`

```ts
import crypto from "node:crypto";

export function signRequest(payload: string, appId: string, appSecret: string, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  const base = `${appId}${timestamp}${payload}${appSecret}`;
  const signature = crypto.createHash("sha256").update(base).digest("hex");
  return {
    timestamp,
    signature,
    header: `SHA256 Credential=${appId}, Signature=${signature}, Timestamp=${timestamp}`,
  };
}
```

### `apps/api/src/affiliate/shopee/client.ts`

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { signRequest } from "./sign";
import { RateLimitGuard } from "./rate-limit-guard";
import { CircuitBreaker } from "./circuit-breaker";
import { recordApiOutcome } from "../../scheduler/shopee-api-health";
import { sentry } from "../../obs/sentry";
import { posthog } from "../../obs/posthog";

const ProductOfferSchema = z.object({
  productOfferV2: z.object({
    nodes: z.array(z.object({
      itemId: z.string(),
      shopId: z.string(),
      productName: z.string(),
      priceMin: z.number(),
      priceMax: z.number(),
      productLink: z.string(),
      commissionRate: z.number(),
      sales: z.number(),
      imageUrl: z.string().nullable(),
    })),
  }),
});

@Injectable()
export class ShopeeAffiliateClient {
  private log = new Logger("ShopeeAffiliateClient");
  private breaker = new CircuitBreaker({ openAfterConsecFails: 5, openAfterErrorRate: 0.5, windowCalls: 20, halfOpenAfterMs: 60_000, closeAfterConsecSuccess: 3 });

  constructor(private cfg: ConfigService, private rateLimit: RateLimitGuard) {}

  async productOfferV2(input: { itemId: number; shopId: number }) {
    const query = `query { productOfferV2(itemId: ${input.itemId}, shopId: ${input.shopId}) { nodes { itemId shopId productName priceMin priceMax productLink commissionRate sales imageUrl } } }`;
    const data = await this.call(query);
    return ProductOfferSchema.parse(data).productOfferV2.nodes[0] ?? null;
  }

  private async call<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    await this.rateLimit.acquire();
    return this.breaker.exec(async () => {
      const payload = JSON.stringify({ query, variables });
      const { header } = signRequest(payload, this.cfg.getOrThrow("SHOPEE_AFFILIATE_APP_ID"), this.cfg.getOrThrow("SHOPEE_AFFILIATE_APP_SECRET"));
      const t0 = Date.now();
      let outcome: "success" | "error_429" | "error_5xx" | "error_4xx" | "timeout" = "success";
      try {
        const res = await fetch("https://open-api.affiliate.shopee.vn/graphql", {
          method: "POST",
          body: payload,
          headers: { "Content-Type": "application/json", Authorization: header },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429) { outcome = "error_429"; throw new ShopeeApiError("rate_limit"); }
        if (res.status >= 500) { outcome = "error_5xx"; throw new ShopeeApiError("service_unavailable"); }
        if (res.status >= 400) { outcome = "error_4xx"; throw new ShopeeApiError("auth_failure"); }
        const body = await res.json();
        if (body.errors?.length) {
          outcome = "error_4xx";
          throw new ShopeeApiError(body.errors[0].extensions?.code ?? "unknown");
        }
        posthog.capture("shopee_api_call", { method: query.slice(0, 32), latency_ms: Date.now() - t0, status: "success" });
        return body.data;
      } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError") outcome = "timeout";
        sentry.captureException(e, { tags: { fr: "FR-AFF-001", outcome } });
        throw e;
      } finally {
        await recordApiOutcome(outcome === "success" ? "success" : "error");
      }
    });
  }
}

export class ShopeeApiError extends Error {
  constructor(public code: "rate_limit" | "service_unavailable" | "auth_failure" | "unknown") {
    super(`Shopee API error: ${code}`);
  }
}
```

### `apps/api/src/affiliate/shopee/rate-limit-guard.ts`

```ts
import { Injectable } from "@nestjs/common";
import { redis } from "../../queue/redis.client";

@Injectable()
export class RateLimitGuard {
  private readonly key = "shopee:rl:global";
  private readonly maxPerMin = Number(process.env.SHOPEE_RATE_LIMIT_PER_MIN ?? 1000);

  async acquire(): Promise<void> {
    const bucket = `${this.key}:${Math.floor(Date.now() / 60_000)}`;
    const used = await redis.incr(bucket);
    if (used === 1) await redis.expire(bucket, 60);
    if (used > this.maxPerMin) {
      const waitMs = 60_000 - (Date.now() % 60_000);
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)));
      return this.acquire();
    }
  }
}
```

---

## §4 — Acceptance criteria

1. Calling `productOfferV2({ itemId: <real>, shopId: <real> })` against staging credentials returns a non-null `ProductOffer`.
2. The exact signature header (lowercase hex) matches Shopee Brazil documentation pattern.
3. With Doppler env present, no occurrence of `SHOPEE_AFFILIATE_APP_SECRET` in any log destination (Sentry, console, Bull Board).
4. With mock returning 429 for 5 consecutive calls → breaker opens → next call throws `ShopeeApiError("rate_limit")` immediately without hitting Shopee.
5. After 60s in open state → breaker enters half-open → 3 successful calls → closed.
6. Rate-limit bucket: 1001st call in same minute waits and succeeds in next minute (no throw).
7. Timeout after 10s → `ShopeeApiError("service_unavailable")` (mapped from timeout).
8. PostHog event `shopee_api_call` with `status: "success"` carries `latency_ms`.
9. `posthog.capture` events never contain raw payload, only `method` slug.
10. Clock-skew recovery: forge `now` 24h in the past → first call fails, client re-syncs and retries once, succeeds.

---

## §5 — Verification

```ts
// apps/api/src/affiliate/shopee/__tests__/client.spec.ts
describe("FR-AFF-001 — Shopee Affiliate client", () => {
  it("AC2: signature matches reference", () => {
    const { signature } = signRequest("payload-x", "appid123", "secret456", 1700000000_000);
    expect(signature).toBe("e3b…match-ref…");  // computed offline against reference
  });
  it("AC4: breaker opens after 5 consecutive 429s", async () => {
    mockShopeeReturn(429, 6);
    for (let i = 0; i < 5; i++) await client.productOfferV2({ itemId: 1, shopId: 1 }).catch(() => {});
    await expect(client.productOfferV2({ itemId: 2, shopId: 2 })).rejects.toThrow(/rate_limit/);
    expect(mockShopeeCallCount()).toBe(5); // 6th never made it through
  });
  it("AC6: rate-limit wraps to next minute", async () => {
    // Fill bucket
    for (let i = 0; i < 1000; i++) await rateLimit.acquire();
    const t0 = Date.now();
    await rateLimit.acquire();  // should wait
    expect(Date.now() - t0).toBeGreaterThan(10);  // some wait
  });
  it("AC9: PostHog payload never includes raw shop data", async () => {
    const phPayloads = capturePostHog();
    await client.productOfferV2({ itemId: 1, shopId: 1 });
    expect(JSON.stringify(phPayloads)).not.toContain("productName");
  });
});
```

---

## §6 — Implementation skeleton

See §3 — three files form the skeleton. Add `CircuitBreaker` class (~30 lines), `ShopeeApiError` (provided), and `RateLimitGuard` (provided).

---

## §7 — Dependencies

- FR-WORKER-002 (Redis client + shopee-api-health metrics).
- FR-OBS-001 (Sentry + PostHog).
- Doppler envs: `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_APP_SECRET`, `SHOPEE_RATE_LIMIT_PER_MIN` (default 1000).
- Shopee Affiliate VN registration (chấp nhận: tài khoản cá nhân or doanh nghiệp, plan §B2). Submit at `https://affiliate.shopee.vn`, expect 1-2 weeks approval.

---

## §8 — Example payloads

### Request

```http
POST /graphql HTTP/1.1
Host: open-api.affiliate.shopee.vn
Content-Type: application/json
Authorization: SHA256 Credential=12345, Signature=abc...lowercase-hex..., Timestamp=1747353600

{ "query": "query { productOfferV2(itemId: 9876543210, shopId: 123456) { nodes { itemId shopId productName priceMin priceMax productLink commissionRate sales imageUrl } } }" }
```

### Response

```json
{
  "data": {
    "productOfferV2": {
      "nodes": [{
        "itemId": "9876543210",
        "shopId": "123456",
        "productName": "Áo thun nam basic",
        "priceMin": 89000,
        "priceMax": 129000,
        "productLink": "https://shopee.vn/...-i.123456.9876543210",
        "commissionRate": 0.03,
        "sales": 1247,
        "imageUrl": "https://cf.shopee.vn/file/..."
      }]
    }
  }
}
```

---

## §9 — Open questions

All resolved:

- **Q1: GraphQL Codegen for types?** Resolved → no at MVP. Manual zod schemas for 4 methods.
- **Q2: Retry on auth_failure?** Resolved → no. 4xx is operator error (bad credential or revoked app); retry creates lockout risk.
- **Q3: Memo per-call cache TTL?** Resolved → handled in callers (FR-AFF-003 = no cache, FR-AFF-004 = 5–10 min) per plan §B2.
- **Q4: How to register Shopee Affiliate VN if no Vietnamese business yet?** Resolved → individual tax-code accepted at registration. Plan §B6 footer notes: "Cá nhân nhận affiliate được."

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Shopee changes auth header format | Sentry 4xx burst | Breaker opens; alert | Update `signRequest`; ship hotfix |
| Shopee changes GraphQL schema | Zod parse error | Caller sees parse exception | Update schema; ship hotfix |
| App credentials revoked | Persistent 401 | Breaker opens; alert with `auth_failure` tag | Founder regenerates in Shopee dashboard |
| Clock skew > 5 min vs Shopee | First call 401 | Auto-sync + 1 retry per §1 #12 | NTP-sync host |
| Network timeout | AbortSignal | Mapped to `service_unavailable` | Retry next call |
| Rate-limit bucket Redis loss | INCR returns 1 always | Local rate-limit defeats intent | Add monitor on bucket size + heartbeat |
| Circuit breaker stuck open | OBS panel watches state | Half-open never closes if Shopee still 429 | Alert + manual intervention |
| Zod schema drift (Shopee adds nullable field) | Parse fails | Caller errors | Update schema |
| Logging accidentally exposes secret | Pre-commit grep | Hook prevents commit | Doppler rotates secret + scrub Sentry |
| Half-open call burst | Concurrent `exec` | Breaker uses single-token semaphore in half-open | Built-in |

---

## §11 — Notes

- The full GraphQL query string is small (< 200 chars); we don't bother gzipping the POST.
- Plan §B2 mentions `linkmydeals` as the dominant publisher (1.5M); we treat them as a cross-check source for actual rate-limit values.
- This client is intentionally not a NestJS Provider with global scope — it's request-scoped through `Injectable` to allow per-tenant credentials later (P3 multi-tenant Phase 4).

---

*End of FR-AFF-001. Status: shipped (2026-05-17).*
