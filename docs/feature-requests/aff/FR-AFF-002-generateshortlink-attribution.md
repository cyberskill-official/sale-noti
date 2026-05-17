---
id: FR-AFF-002
title: "`generateShortLink(originUrl, subIds[])` deeplink with userId + watchlistId attribution sub-id"
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
related_frs: [FR-AFF-001, FR-AFF-003, FR-NOTIF-001, FR-LEGAL-002, FR-EXT-001, FR-GROW-002]
depends_on: [FR-AFF-001, FR-LEGAL-002]
blocks: [FR-NOTIF-001, FR-NOTIF-002, FR-NOTIF-003, FR-GROW-002, FR-EXT-001]
effort_hours: 4

new_files:
  - apps/api/src/affiliate/deeplink.service.ts
  - apps/api/src/affiliate/deeplink.controller.ts
  - apps/api/src/affiliate/__tests__/deeplink.spec.ts
modified_files: []
allowed_tools:
  - "file_read/write apps/api/**"
  - "bash pnpm test"
disallowed_tools:
  - "embed user PII in subIds (use opaque hash, never email or raw userId)"
  - "generate deeplink without pre-click interstitial (plan §A3 principle 2)"
  - "override existing Shopee Affiliate cookie (plan §A3 principle 3, FR-LEGAL-002 §1 #9)"
  - "log raw `shortUrl` or `originUrl` in PostHog events (only hashed dimensions allowed)"
  - "rank or filter products by `commissionRate` (FR-LEGAL-002 §1 #10)"
risk_if_skipped: "Plan §B2 makes generateShortLink the canonical commission attribution channel. Without per-userId subId attribution we can't (a) join the Shopee commission webhook back to the user who clicked, (b) compute the quarterly Transparency Report's per-source revenue breakdown required by FR-LEGAL-002 §1 #7, (c) settle the founder's open-source revenue calculator on /legal/affiliate. Every alert email, push notification, Telegram message, share-deal landing, and extension button uses this service; if it ships wrong the entire P1 attribution layer breaks."

---

## §1 — Description (BCP-14 normative)

The deeplink service MUST provide a single canonical entry point for converting a SaleNoti-internal `productId` into a Shopee Affiliate short URL carrying user-specific attribution sub-ids, while honoring the five ethical principles from FR-LEGAL-002 §1 #8–#10.

1. **MUST** call `ShopeeAffiliateClient.generateShortLink({ originUrl, subIds })` (FR-AFF-001) where `originUrl` matches the regex in §1 #6 and `subIds` is an array of exactly five strings with semantics:
   - `subIds[0] = "salenoti"` (fixed publisher identifier).
   - `subIds[1] = userIdHashShort` per §1 #2.
   - `subIds[2] = watchlistIdShort | "0"` per §1 #2 (literal `"0"` when caller does not supply a watchlistId).
   - `subIds[3] = source ∈ { "alert_email" | "alert_push" | "alert_telegram" | "deal_page" | "share_deal" | "ext" }` — closed enum; new sources require a new FR.
   - `subIds[4] = campaign` — scrubbed per §1 #11 (default `"default"`).
2. **MUST** compute `userIdHashShort = sha256(userId + DEEPLINK_SALT).slice(0, 12)` and `watchlistIdShort = sha256(watchlistId).slice(0, 8)`. The salt MUST be loaded from Doppler env `DEEPLINK_SALT` (minimum 32 hex chars). Hashes are opaque and irreversible by external observers; only the SaleNoti backend with access to `affiliate_links.userId` can reverse them.
3. **MUST** persist every issued deeplink in MongoDB `affiliate_links` collection with the schema in §3. The row carries the raw `userId` / `watchlistId` for internal reconciliation, plus the exact `subIds` array that Shopee returns commission webhooks against in P2.
4. **MUST** expose `POST /v1/affiliate/deeplink` with body `{ productId, source, watchlistId?, campaign?, respect_other_publisher? }`. Response shape `{ url: string, expiresAt: Date | null }`.
5. **MUST** cache the generated short-link in Redis keyed by `dl:<userId>:<productId>:<source>:<campaign>` with TTL 24 hours (per FR-AFF-002 §1 #5 plan reference — "cache 24h" matches Shopee's own short-link stability window). On cache hit the row's `cacheHits` counter MUST be incremented atomically via Mongo `$inc` so we can audit cache pressure.
6. **MUST** validate `originUrl` matches `^https://shopee\.vn/.+-i\.\d+\.\d+(?:\?.*)?$` AND that the `(shopId, itemId)` extracted from the URL matches the `productId` parameter. Mismatch → 400 `invalid_shopee_url`. This is defense against an attacker passing a `productId` of their choice while smuggling an off-brand `originUrl` through the resolver cache.
7. **MUST NOT** be called from any client-facing code path that does not surface the `<PreClickInterstitial />` (FR-LEGAL-002 §1 #6) to the user *before* dispatching the resulting URL into a click flow. The only public client-side export from the disclosure module is `useDeeplinkWithInterstitial()`; that hook is the choke-point.
8. **MUST** honor `respect_other_publisher: true` flag (set by FR-EXT-001 §1 #5 when the extension detects an existing Shopee affiliate cookie on the user's browser). When set, the service MUST return the raw `originUrl` without calling Shopee at all, MUST still persist an `affiliate_links` row with `subIds: [..., "respected"]` (subId[4]="respected") for audit, and MUST emit PostHog event `affiliate_link_respected_publisher` so we can publish the count quarterly.
9. **MUST** emit PostHog event `affiliate_link_generated` with properties `{ source, userIdHash, productIdHash, campaign, cached: bool, respect_other_publisher: bool, latency_ms: number }`. No raw URL, no raw userId, no raw shop/item ID. `userIdHash` and `productIdHash` use the same SHA-256 + 12-char-prefix shape as §1 #2.
10. **MUST** complete the round-trip in p95 < 600 ms on cache miss (Shopee `generateShortLink` is the long pole at ~400-500 ms) and p95 < 50 ms on cache hit. Latency observed via PostHog property `latency_ms`.
11. **MUST** scrub `campaign` field server-side: regex-strip to `[A-Za-z0-9_-]+`, cap at 20 chars, default to `"default"` when empty or all-stripped. This prevents cardinality explosion in Shopee's commission report and PostHog's event store.
12. **MUST** be transactionally idempotent against parallel concurrent calls with the same `(userId, productId, source, campaign)` tuple. The first call wins (Shopee API hit + row insert + cache populate); concurrent racers observe cache populated on retry via 50ms-jitter retry. Implementation: `SET NX` on the cache key as a coarse lease.
13. **MUST NOT** rank, filter, or otherwise alter ordering of products based on commission rate. The `commissionRate` field is informational metadata on the `affiliate_links` row only. This re-asserts FR-LEGAL-002 §1 #10 at the deeplink layer (any future code that touches commission rates for ranking purposes is caught by the grep CI gate).
14. **MUST** rate-limit per-user calls to `POST /v1/affiliate/deeplink` at 30 req/min/userId via Redis token bucket. Excess returns 429 with `Retry-After: 60`.

---

## §2 — Why this design

**Why 5 subId fields (Shopee API supports up to 5):** plan §B2 mentions "subIds" as the attribution surface. Five dimensions let us slice the quarterly Transparency Report (FR-LEGAL-002 §1 #7) by source, user cohort, watchlist activity, and marketing campaign — sufficient to answer "how much of our commission revenue came from email alerts in November during 11.11?". Six dimensions would force us into a custom URL-shortener layer; four would force us to merge source + campaign or drop one. Five is exactly Shopee's API ceiling. Aligning to the ceiling means no custom layer and zero ambiguity on what each subId means.

**Why opaque user-hash (sha256 + 12 chars) not raw userId:** if Shopee's affiliate dashboard or its click-log export is ever leaked, scraped, or subpoena'd, we don't want our internal MongoDB ObjectIds exposed as that's a fingerprint-able mapping back to our user list. A 12-char SHA-256 prefix has ~10^14 collision space (sufficient for 10 K-100 K users; we revisit at 1 M). The salt makes it irreversible without backend access. Same defense-in-depth pattern as the PostHog distinctId redaction in FR-OBS-001.

**Why 24-hour cache:** Shopee's short links are stable URLs for the day they're issued; calling `generateShortLink` for every alert click is wasted API budget. At 10 K active users × 3-5 alerts each per day = 30-50 K calls/day uncached vs ~5 K with cache (10× savings against the 1 K/min ceiling from FR-WORKER-002). 24 h is the natural unit: Shopee re-issues attribution daily; a cache entry that lives 24 h matches that exactly without forcing a custom expiry-tracking layer.

**Why `useDeeplinkWithInterstitial()` as the only public client surface:** FR-LEGAL-002 §1 #6 mandates pre-click disclosure on first affiliate-link click per session. By making the client-side hook the only public export from the disclosure module (the service-side function is server-only and unexposed to React components), it becomes mechanically impossible for a feature engineer to accidentally ship a click flow that skips the interstitial. The pattern echoes how `next-auth` only exposes its handlers via `{ handlers }` — the API shape prevents the foot-gun. Compile-time enforcement, not policy.

**Why respect other publishers' cookies:** plan §A2 details how the Honey scandal destroyed PayPal's trust by overriding KOC affiliate cookies at click time. Plan §A3 principle 3 codifies our counter-position: if a user is already on a path attributed to another publisher (a Vietnamese KOC, a Facebook deal-group admin), that publisher earned the attribution and we don't get to override it. FR-EXT-001 §1 #5 detects the publisher cookie at the DOM level; this FR honors the resulting `respect_other_publisher: true` flag end-to-end by routing around Shopee `generateShortLink` entirely. The cost to us is one click of revenue per affected user; the benefit is the moat trust differential at the heart of the SaleNoti thesis.

**Why quarterly Transparency Report dimensions = these 5 subIds, not 3 or 7:** plan §F2 #5 (SEO content drive on `salenoti.vn/deal/<slug>`) introduces `deal_page` as a distinct source-of-acquisition from `alert_email`; both eventually convert via the same Shopee deeplink, and we need to attribute the conversion to whichever surface drove the click so the FE roadmap can be data-driven. Three subIds (user, source, campaign) would conflate `deal_page` clicks from a watchlist with clicks from a public deal-page visitor; we need to distinguish those two cases for retention analysis.

**Why `productId` must match `originUrl`:** without this server-side cross-check, an attacker could `POST /v1/affiliate/deeplink` with `productId: <legit-product>` but `originUrl: <attacker-controlled-URL>` smuggled through some upstream injection. The mismatch check makes the deeplink output strictly bound to the resolver-validated product.

**Why 30 req/min/userId rate limit:** legitimate users hit this endpoint at most a few times per dashboard view (one click per product card). 30/min covers heavy interactive dashboard use (e.g., bulk-comparing 25 products in 60s) while blocking enumeration scans where an attacker tries to mint links for every shop+item combo.

---

## §3 — API contract & code shape

### `POST /v1/affiliate/deeplink`

```http
POST /v1/affiliate/deeplink HTTP/1.1
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "productId": "123456-9876543210",
  "source": "alert_email",
  "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1",
  "campaign": "default"
}
```

Success:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "ok": true,
  "url": "https://shope.ee/AbCdEf123",
  "expiresAt": null
}
```

Errors:

| Status | Body shape | When |
|---|---|---|
| 400 | `{ "ok": false, "error": "invalid_shopee_url" }` | originUrl regex fails OR productId↔originUrl mismatch |
| 400 | `{ "ok": false, "error": "product_not_found" }` | products row absent |
| 400 | `{ "ok": false, "error": "validation_failed", "issues": [...] }` | zod parse |
| 401 | `{ "ok": false, "error": "unauthenticated" }` | missing JWT |
| 429 | `{ "ok": false, "error": "rate_limit", "retryAfter": 60 }` | 31st call/min |
| 503 | `{ "ok": false, "error": "service_unavailable" }` | Shopee breaker open |

### MongoDB `affiliate_links` collection

```ts
{
  _id: ObjectId,
  userId: ObjectId,                    // FK to users (raw, NOT hashed — internal use)
  productId: string,                    // "<shopId>-<itemId>"
  watchlistId: ObjectId | null,
  subIds: [string, string, string, string, string],  // exactly 5
  originUrl: string,                    // the Shopee canonical URL we resolved
  shortUrl: string,                     // shope.ee/... returned by Shopee
  source: "alert_email" | "alert_push" | "alert_telegram" | "deal_page" | "share_deal" | "ext",
  campaign: string,                     // matches subIds[4]
  createdAt: Date,
  expiresAt: Date | null,               // null because Shopee links are stable
  cacheHits: number,                    // bumped on every cache hit
  respectOtherPublisher: boolean,
  conversions: [                        // populated by FR-AFF-007 commission webhook reconcile (P2)
    {
      commissionVnd: number,
      currency: "VND",
      confirmedAt: Date,
      shopeeOrderId: string
    }
  ]
}
// Indexes
//   { userId: 1, productId: 1, source: 1, campaign: 1, createdAt: -1 }  // primary lookup
//   { subIds: 1 }                                                        // webhook join
//   { createdAt: -1 }                                                    // analytics scans
```

### Service implementation skeleton

```ts
// apps/api/src/affiliate/deeplink.service.ts
@Injectable()
export class DeeplinkService {
  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    private readonly cfg: ConfigService,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const t0 = Date.now();
    const product = await this.lookupProduct(input.productId);
    if (!product) throw new BadRequestException("product_not_found");
    if (!SHOPEE_URL_REGEX.test(product.url)) throw new BadRequestException("invalid_shopee_url");
    // §1 #6 — productId↔originUrl cross-check
    const m = product.url.match(/-i\.(\d+)\.(\d+)/);
    if (!m || `${m[1]}-${m[2]}` !== input.productId) throw new BadRequestException("invalid_shopee_url");

    // FR-AFF-002 §1 #8 — respect other publisher.
    if (input.respectOtherPublisher) {
      await this.recordRespected({ ...input, product });
      this.posthog.capture("affiliate_link_respected_publisher", { source: input.source });
      return { url: product.url, expiresAt: null, cached: false };
    }

    const subIds = this.buildSubIds(input);
    const cacheKey = `dl:${input.userId}:${input.productId}:${input.source}:${subIds[4]}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      await mongo.db("salenoti").collection("affiliate_links").updateOne(
        { shortUrl: cached, userId: this.toObjectId(input.userId) },
        { $inc: { cacheHits: 1 } }
      );
      this.observe(t0, input, true);
      return { url: cached, expiresAt: null, cached: true };
    }

    // FR-AFF-002 §1 #12 — coarse lease via SET NX with 5s TTL to absorb parallel racers.
    const lease = await redis.set(`${cacheKey}:lease`, "1", "EX", 5, "NX");
    if (lease !== "OK") {
      // Lost race; brief jitter then re-read cache.
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      const second = await redis.get(cacheKey);
      if (second) return { url: second, expiresAt: null, cached: true };
    }

    const { shortLink } = await this.shopee.generateShortLink({ originUrl: product.url, subIds });
    await mongo.db("salenoti").collection("affiliate_links").insertOne({
      userId: this.toObjectId(input.userId),
      productId: input.productId,
      watchlistId: input.watchlistId ? this.toObjectId(input.watchlistId) : null,
      subIds,
      originUrl: product.url,
      shortUrl: shortLink,
      source: input.source,
      campaign: subIds[4],
      createdAt: new Date(),
      expiresAt: null,
      cacheHits: 0,
      respectOtherPublisher: false,
      conversions: [],
    });
    await redis.setex(cacheKey, 86_400, shortLink);
    this.observe(t0, input, false);
    return { url: shortLink, expiresAt: null, cached: false };
  }

  private buildSubIds(input: GenerateInput): [string, string, string, string, string] {
    const userHash = sha256(input.userId + this.cfg.getOrThrow("DEEPLINK_SALT")).slice(0, 12);
    const wlHash = input.watchlistId ? sha256(input.watchlistId).slice(0, 8) : "0";
    return ["salenoti", userHash, wlHash, input.source, this.scrubCampaign(input.campaign)];
  }

  private scrubCampaign(c: string | undefined): string {
    if (!c) return "default";
    return c.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "default";
  }

  private observe(t0: number, input: GenerateInput, cached: boolean) {
    this.posthog.capture("affiliate_link_generated", {
      source: input.source,
      userIdHash: sha256(input.userId).slice(0, 12),
      productIdHash: sha256(input.productId).slice(0, 12),
      campaign: this.scrubCampaign(input.campaign),
      cached,
      respect_other_publisher: Boolean(input.respectOtherPublisher),
      latency_ms: Date.now() - t0,
    });
  }
}
```

---

## §4 — Acceptance criteria

1. `POST /v1/affiliate/deeplink` with valid product + source returns 200 + `https://shope.ee/...` short URL; an `affiliate_links` row is inserted with `subIds: ["salenoti", <12-hex>, <8-hex or "0">, <source>, <campaign>]`.
2. Same call within 24 h returns cached URL; no Shopee API call is made; cache hit incremented on the row's `cacheHits` field.
3. PostHog event `affiliate_link_generated` carries `userIdHash` (12-char hex), `productIdHash`, `campaign`, `cached: bool`, `latency_ms`. Raw URL is absent from event payload.
4. Origin URL regex fail (e.g., `https://tiki.vn/x-i.1.2`) → 400 `invalid_shopee_url`.
5. `productId` parameter does not match `originUrl` `(shopId, itemId)` extraction → 400 `invalid_shopee_url`.
6. Missing JWT → 401 `unauthenticated`.
7. Calling deeplink service from client-side code that does not import `useDeeplinkWithInterstitial()` → TypeScript build error (the service-side function is server-only and unimported from any `"use client"` module).
8. `respect_other_publisher: true` request → server returns origin URL unchanged (no `shope.ee` wrap); `affiliate_links` row created with `subIds[4] = "respected"` and `respectOtherPublisher: true`; PostHog event `affiliate_link_respected_publisher` fires.
9. Campaign field `"evil!@#$%abc"` → scrubbed to `"evilabc"`; subIds[4] equals scrubbed value; PostHog event `campaign` property matches.
10. Empty campaign → scrubbed to `"default"`.
11. 31st call in 60s from same userId → 429 with `Retry-After: 60`.
12. Latency p95: cache miss < 600 ms (Shopee API mocked at ~400 ms), cache hit < 50 ms.
13. Two parallel concurrent calls with identical `(userId, productId, source, campaign)` → exactly one Shopee API call, one row insert, one cache write. Second call returns cached value.
14. Grep audit: `grep -RE "commissionRate" apps/api/src/affiliate/` returns matches only in `offer-resolver.service.ts` (writer) and `types.ts` (zod schema). No ORDER BY / sort / rank by commission anywhere in `deeplink.service.ts` or `deeplink.controller.ts`.

---

## §5 — Verification

```ts
// apps/api/src/affiliate/__tests__/deeplink.spec.ts
import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";

describe("FR-AFF-002 — DeeplinkService", () => {
  it("AC1: returns short URL + persists row with correct subIds", async () => {
    mockShopeeGenerateShortLink({ shortLink: "https://shope.ee/AbCdEf" });
    const r = await api.post("/v1/affiliate/deeplink", { productId: "123456-9876", source: "alert_email" });
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/shope\.ee\//);
    const row = await mongo.db("salenoti").collection("affiliate_links").findOne({ shortUrl: r.body.url });
    expect(row?.subIds).toEqual([
      "salenoti",
      expect.stringMatching(/^[a-f0-9]{12}$/),
      expect.stringMatching(/^[a-f0-9]{8}|0$/),
      "alert_email",
      "default",
    ]);
  });

  it("AC2: 24h cache, second call no Shopee hit, cacheHits incremented", async () => {
    const r1 = await api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "alert_email" });
    const callsBefore = shopeeCallCount();
    const r2 = await api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "alert_email" });
    expect(r2.body.url).toBe(r1.body.url);
    expect(shopeeCallCount()).toBe(callsBefore);
    const row = await mongo.db("salenoti").collection("affiliate_links").findOne({ shortUrl: r2.body.url });
    expect(row?.cacheHits).toBe(1);
  });

  it("AC3: PostHog event redacts URL + raw userId", async () => {
    const events = capturePostHog();
    await api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "alert_email" });
    const event = events.find((e) => e.event === "affiliate_link_generated");
    expect(JSON.stringify(event)).not.toContain("shope.ee");
    expect(JSON.stringify(event)).not.toContain(rawUserId);
    expect(event!.properties.userIdHash).toMatch(/^[a-f0-9]{12}$/);
    expect(event!.properties.latency_ms).toBeGreaterThan(0);
  });

  it("AC4: non-shopee.vn URL rejected", async () => {
    seedProductWithUrl("1-1", "https://tiki.vn/x-i.1.1");
    const r = await api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "ext" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_shopee_url");
  });

  it("AC5: productId mismatch with originUrl rejected", async () => {
    seedProductWithUrl("1-1", "https://shopee.vn/x-i.99.99");
    const r = await api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "ext" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_shopee_url");
  });

  it("AC8: respect_other_publisher returns origin unchanged + audit row", async () => {
    const r = await api.post("/v1/affiliate/deeplink", {
      productId: "1-1",
      source: "ext",
      respect_other_publisher: true,
    });
    expect(r.body.url).toMatch(/^https:\/\/shopee\.vn\/.*-i\.1\.1$/);
    expect(r.body.url).not.toContain("shope.ee");
    expect(shopeeCallCount()).toBe(0);
    const row = await mongo.db("salenoti").collection("affiliate_links").findOne({ originUrl: r.body.url });
    expect(row?.respectOtherPublisher).toBe(true);
    expect(row?.subIds[4]).toBe("respected");
  });

  it("AC9+10: campaign scrubbing", async () => {
    const r1 = await api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "ext", campaign: "evil!@#$%abc" });
    expect(r1.body.url).toBeDefined();
    const row1 = await mongo.db("salenoti").collection("affiliate_links").findOne({ shortUrl: r1.body.url });
    expect(row1?.subIds[4]).toBe("evilabc");

    const r2 = await api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "ext", campaign: "!!!" });
    const row2 = await mongo.db("salenoti").collection("affiliate_links").findOne({ shortUrl: r2.body.url });
    expect(row2?.subIds[4]).toBe("default");
  });

  it("AC11: 31st call/min from same user → 429", async () => {
    for (let i = 0; i < 30; i++) await api.post("/v1/affiliate/deeplink", { productId: `1-${i}`, source: "ext" });
    const r = await api.post("/v1/affiliate/deeplink", { productId: "1-99", source: "ext" });
    expect(r.status).toBe(429);
    expect(r.body.retryAfter).toBe(60);
  });

  it("AC13: parallel calls produce one Shopee hit + one row", async () => {
    const before = shopeeCallCount();
    const [a, b] = await Promise.all([
      api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "ext" }),
      api.post("/v1/affiliate/deeplink", { productId: "1-1", source: "ext" }),
    ]);
    expect(a.body.url).toBe(b.body.url);
    expect(shopeeCallCount() - before).toBe(1);
    const rows = await mongo.db("salenoti").collection("affiliate_links").find({ shortUrl: a.body.url }).toArray();
    expect(rows).toHaveLength(1);
  });

  it("AC14: no commissionRate ranking in deeplink path", () => {
    const files = ["deeplink.service.ts", "deeplink.controller.ts"];
    for (const f of files) {
      const src = fs.readFileSync(`apps/api/src/affiliate/${f}`, "utf8");
      expect(src).not.toMatch(/ORDER BY[\s\S]*commission/i);
      expect(src).not.toMatch(/sortBy.*commission/i);
      expect(src).not.toMatch(/sort.*commissionRate/i);
    }
  });
});
```

---

## §6 — Implementation skeleton

See §3 — DeeplinkService is the canonical implementation. Companion `deeplink.controller.ts`:

```ts
@Controller("v1/affiliate")
@UseGuards(DeeplinkRateGuard)
export class DeeplinkController {
  constructor(private readonly deeplink: DeeplinkService) {}

  @Post("deeplink")
  async generate(@Body() body: unknown, @Headers("x-user-id") userId: string | undefined) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = Body_.safeParse(body);
    if (!parsed.success) throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    return this.deeplink.generate({ userId, ...parsed.data });
  }
}
```

Plus the rate-limit guard:

```ts
@Injectable()
class DeeplinkRateGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.headers["x-user-id"];
    if (!userId) return true; // unauthenticated will be rejected by the controller anyway
    const bucket = `rl:dl:${userId}:${Math.floor(Date.now() / 60000)}`;
    const used = await redis.incr(bucket);
    if (used === 1) await redis.expire(bucket, 60);
    if (used > 30) throw new HttpException({ ok: false, error: "rate_limit", retryAfter: 60 }, 429);
    return true;
  }
}
```

---

## §7 — Dependencies

- **External:** Shopee Affiliate Open API approval (FR-AFF-001 lead). `DEEPLINK_SALT` env (32+ hex chars; `openssl rand -hex 32`) in Doppler.
- **Internal:** FR-AFF-001 (Shopee client + circuit breaker + rate-limit guard), FR-LEGAL-002 (interstitial component + 5-principles firewall), FR-AFF-003 indirectly (writes `products.affiliateLink` which becomes the canonical originUrl).
- **Infrastructure:** MongoDB Atlas with indexes per §3, Redis for cache + rate-limit + lease.
- **Optional:** PostHog (for the redacted event), Sentry (for the breaker-open warning).

---

## §8 — Example payloads

### Successful generation (cache miss)

```http
POST /v1/affiliate/deeplink
{ "productId": "123456-9876543210", "source": "alert_email", "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1" }

→ 200 OK
{ "ok": true, "url": "https://shope.ee/AbCdEf", "expiresAt": null }
```

### Resulting row

```json
{
  "_id": "65f9...",
  "userId": "65f7a2b3c4d5e6f7a8b9c0d2",
  "productId": "123456-9876543210",
  "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1",
  "subIds": ["salenoti", "a3f9c2d1e7b8", "01J9Z8K2", "alert_email", "default"],
  "originUrl": "https://shopee.vn/Áo-thun-nam-basic-i.123456.9876543210",
  "shortUrl": "https://shope.ee/AbCdEf",
  "source": "alert_email",
  "campaign": "default",
  "createdAt": "2026-05-16T11:00:00Z",
  "expiresAt": null,
  "cacheHits": 0,
  "respectOtherPublisher": false,
  "conversions": []
}
```

### PostHog event (redacted)

```json
{
  "event": "affiliate_link_generated",
  "properties": {
    "source": "alert_email",
    "userIdHash": "a3f9c2d1e7b8",
    "productIdHash": "8a7b6c5d4e3f",
    "campaign": "default",
    "cached": false,
    "respect_other_publisher": false,
    "latency_ms": 412
  }
}
```

### Respect-other-publisher response

```http
POST /v1/affiliate/deeplink
{ "productId": "123456-9876543210", "source": "ext", "respect_other_publisher": true }

→ 200 OK
{ "ok": true, "url": "https://shopee.vn/Áo-thun-nam-basic-i.123456.9876543210", "expiresAt": null }
```

### Commission webhook reconcile (P2 — preview of how subIds get used)

```http
POST /webhooks/shopee/commission   ← future FR-AFF-007
{
  "subIds": ["salenoti", "a3f9c2d1e7b8", "01J9Z8K2", "alert_email", "default"],
  "commissionVnd": 4500,
  "currency": "VND",
  "shopeeOrderId": "ORD-2026-..."
}

→ join affiliate_links on subIds → push to conversions[] → user attribution complete.
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Per-user vs per-tenant short link?** Resolved → per-user. P0/P1 is single-tenant SaleNoti; per-tenant only matters when we ship the B2B Price Intelligence dashboard (FR-ADMIN-002 P3) which has its own auth scope and wouldn't share `affiliate_links`.
- **Q2: Short-link TTL?** Resolved → no Shopee-imposed TTL today; we expire our cache at 24 h; the `affiliate_links` row stays forever (subject to PDPL retention windows documented in FR-LEGAL-001 §1 #7). The row outliving the cache is intentional — commission webhooks may arrive 30+ days after the click.
- **Q3: Encode campaign code in subId4 (alongside source) or subId5 (current)?** Resolved → subId5. subId4 carries the operational dimension (which channel surfaced this link — required for the source-attribution column in the Transparency Report). Campaign is the marketing-experiment dimension. Mixing them collapses analytics.
- **Q4: How does the extension detect another publisher's cookie?** Resolved → FR-EXT-001 §1 #5 reads `document.cookie` on shopee.vn pages and matches against a known list of Shopee Affiliate cookie names (`AFFILIATE_REF`, `sht`, `aff_ref`, `aff_sub`). If matched, the extension calls `/v1/affiliate/deeplink` with `respect_other_publisher: true`. The check is conservative — false positives (treating something as a publisher cookie when it isn't) just mean we forgo a click; false negatives (missing a real publisher cookie) are the failure mode we audit against.
- **Q5: What if Shopee `generateShortLink` 5xx mid-flight?** Resolved → circuit breaker fires per FR-AFF-001 §1 #5; caller sees `service_unavailable` from this endpoint with the breaker tag. Fallback to the raw origin URL with disclosure is the operator's manual call (we'd rather miss a few clicks than disclose nothing).

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Shopee `generateShortLink` 500 | breaker open / 503 from Shopee | caller gets `service_unavailable`; cache & row not written | retry later; if persistent, OBS alert + fallback to origin URL |
| Cache poisoning (Redis returns wrong shortLink for key) | next call's `affiliate_links` row mismatch | one user gets another's deeplink (worst case revenue mis-attribution) | clear cache key; investigate Redis ACL |
| subId hash collision (12 chars) | statistically negligible at MVP scale (10 K users); ~3-9 collisions expected at 1 M users | one user's commission attributed to another | increase hash length to 16 chars at 1 M users (forward-compatible — old subIds keep their 12-char prefix) |
| `DEEPLINK_SALT` rotated mid-cycle | new userHashes won't match old click attributions | pre-rotation Transparency Report period is closed; post-rotation period starts clean | document in rotation runbook; cap rotations to once/quarter |
| `respect_other_publisher` false negative (missed publisher cookie) | rare — quarterly audit | some users' revenue attributed to us instead of legit KOC | refund / re-route quarterly per plan §A3 principle 3 commitment |
| `originUrl` valid but `productId` mismatched (manipulation attempt) | server-side regex extraction matches productId | 400 with `invalid_shopee_url`; logged to Sentry with `kind: "productId_mismatch"` | None — by design |
| Cache stale after manual `products` deletion | Redis key TTL'd; next read repopulates with current row | Self-heals within 24 h | OK |
| Race: two workers resolve same `(user, product, source, campaign)` simultaneously | SET NX lease in §6 | one wins Shopee API call; other waits ~100 ms then reads cache | Built-in |
| PostHog event raw URL leak (regression) | test fixture asserts URL absent from JSON | PR blocked at AC3 | None |
| Campaign field cardinality explosion (someone passes random UUIDs) | server scrub regex strips to alnum + 20 chars | scrubbed value coalesces to a small enum-like set | None |
| Rate limit Redis disconnected | guard fails open (no rate limiting) | minor — Shopee 1 K/min ceiling catches downstream | OBS alert on Redis disconnect |
| `affiliate_links` write fails after Shopee API call | row missing but Shopee thinks click is attributed | Outbox retry queue (P2 hardening) | At MVP scale, manual reconcile |
| Webhook arrives with subIds matching no row (e.g., row purged via PDPL erasure) | `affiliate_links.findOne(subIds)` returns null | Conversion silently dropped from per-user revenue; remains in aggregate | Per plan §B3 PDPL — conversion attributable but not per-user reportable |

---

## §11 — Notes

- The `useDeeplinkWithInterstitial()` typing trick (only public React export from disclosure module) is the cheapest mechanical enforcement of plan §A3 principle 2 ("disclosure rõ ràng đầy đủ trên ... mỗi alert email"). It costs nothing to maintain once set up and catches every regression at compile time.
- Conversion reconciliation (commission webhook from Shopee → join on subIds) is P2 work and lands as FR-AFF-007 in the roadmap. The schema columns (`conversions[]`) are reserved here so the migration to the webhook reconciler is purely an append, not a schema change.
- The "respected" value in `subIds[4]` is a deliberate sentinel — not a real campaign name. The audit query for plan §A3 principle 3 compliance is `SELECT COUNT(*) FROM affiliate_links WHERE subIds[5] = 'respected' AND createdAt > <quarter_start>` and feeds the Transparency Report's "Cases where we honored another publisher's attribution" line.
- Plan §B2 lists `linkmydeals` as the dominant publisher in VN (1.5 M users). We use them as a cross-check source for actual Shopee Affiliate API behavior (e.g., rate limits, expected response shape) during MVP since their integration is publicly observable.

---

*End of FR-AFF-002. Status: shipped (2026-05-17). Last expanded: 2026-05-16.*
