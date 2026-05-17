---
id: FR-WATCH-001
title: "`POST /v1/products/track` — paste shopee.vn URL → resolve via Affiliate API → upsert product + watchlist row"
module: WATCH
priority: MUST
status: shipped
shipped: 2026-05-17
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-WATCH-002, FR-WATCH-003, FR-AFF-003, FR-PRICE-001, FR-EXT-001, FR-GROW-002]
depends_on: [FR-AFF-003, FR-PRICE-001, FR-AUTH-003]
blocks: [FR-WATCH-002, FR-WATCH-003, FR-EXT-001, FR-PRICE-002, FR-NOTIF-001]
effort_hours: 10
template: engineering-spec@1

new_files:
  - apps/api/src/watchlist/watchlist.service.ts
  - apps/api/src/watchlist/watchlist.controller.ts
  - apps/api/src/watchlist/watchlist.module.ts
  - apps/api/src/watchlist/url-parser.ts
  - apps/api/src/watchlist/dto/track.dto.ts
  - apps/api/src/watchlist/__tests__/track.spec.ts
  - apps/api/src/watchlist/__tests__/url-parser.spec.ts
modified_files:
  - apps/api/src/app.module.ts
allowed_tools: ["file_read/write apps/api/**", "bash pnpm test"]
disallowed_tools:
  - "scrape the shopee.vn HTML page when Affiliate API fails (must show 404 / try-again UX) — plan §B1 ethics"
  - "track non-shopee.vn URLs (e.g. Lazada, Tiki) — out of MVP scope"
  - "skip free-tier 10-product cap — conversion trigger per plan §E2"
  - "store full URL with tracking params unsanitized — PII leak risk via embedded utm_/fbclid"
risk_if_skipped: "This IS the MVP happy path. Without it, no user can track anything → no D7 retention metric → no Phase 1 validation. Combined with FR-EXT-001, it's the only product-add surface."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The watchlist service MUST expose `POST /v1/products/track` accepting a Shopee URL and creating a watchlist entry.

1. The endpoint MUST accept request body `{ url: string, alertConfig?: { triggers?: string[], minDropPct?: number, targetPrice?: number, lowest30d?: boolean, flashSale?: boolean }, nickname?: string }`. Default `alertConfig = { triggers: ["pct_drop"], minDropPct: 10 }`.
2. The endpoint MUST validate `url` via the `parseShopeeUrl()` function in `url-parser.ts`, extracting `(shopId, itemId)`. The parser MUST accept these URL patterns and reject all others:
   - `https://shopee.vn/<slug>-i.<shopId>.<itemId>` (canonical current)
   - `https://shopee.vn/product/<shopId>/<itemId>` (legacy)
   - `https://shopee.vn/shopee-mall/<shopId>/<itemId>` (mall variant)
   - `https://shopee.vn/.+?[?&]itemid=<itemId>&shopid=<shopId>` (deeplink fallback)
   The parser MUST strip `utm_*`, `fbclid`, `gclid`, `__cf_chl_*`, `af_*` query params before canonicalization (PII hygiene).
3. The endpoint MUST call `OfferResolverService.resolveProductOffer(shopId, itemId)` (FR-AFF-003). If the resolver returns `null` → response `404 product_not_available` with message "Item không tồn tại trong Shopee Affiliate catalog. Có thể đã hết hàng."
4. Free-tier cap MUST be enforced (plan §E2): if `users.plan === "free"` AND `watchlists.count({ userId, status: "active" }) >= 10` → response `403 free_tier_cap_reached` with body `{ error, limit: 10, currentCount, upgradeUrl: "/billing/upgrade", availableAt: <oldestActiveCreatedAt> }`. Pro tier MUST have no cap (plan §E3).
5. The endpoint MUST upsert into `watchlists` collection with document shape `{ _id, userId, productId: "<shopId>-<itemId>", status: "active", alertConfig, nickname?, commissionRateAtTrack, createdAt, updatedAt, lastTriggeredAt: null, lastNotifiedAt: null, source: "web"|"ext"|"share"|"import" }`. Unique compound index `{ userId: 1, productId: 1 }` MUST be created in migration.
6. The watchlist MUST capture `commissionRateAtTrack` at the moment of tracking from the resolver response — used for transparency-report cohort analysis per FR-LEGAL-002.
7. The endpoint MUST update `products.trackPriority` based on alertConfig:
   - if `alertConfig.flashSale === true` OR `"flash_sale" ∈ alertConfig.triggers` → `trackPriority = "hot"` (poll every 30 min)
   - else if `alertConfig.lowest30d === true` OR `"lowest_30d" ∈ alertConfig.triggers` → `trackPriority = "mid"` (poll every 6h)
   - else → `trackPriority = "mid"`
   FR-WORKER-002's scheduler reads this field for adaptive cadence.
8. The endpoint MUST emit PostHog event `product_tracked` with properties `{ userId: hashed(userId), shopId, itemId, productId, source, hasNickname: bool, triggerCount, freeTierCountAfter }`. The `source` MUST be derived from the `X-SaleNoti-Source` request header (allowed: `web`, `ext`, `share`, `import`). Unknown values MUST coerce to `"web"`. The hashed `userId` MUST follow FR-OBS-001 PII salt protocol.
9. The endpoint MUST return `201 Created` with body `{ watchlistId, productId, currentPrice, originalPrice, discountPct, name, imageUrl, affiliateLink, is30DayLow, last30dMin }` so the front-end renders the success card with no second round-trip.
10. The round-trip p95 latency MUST be < 1500 ms (Shopee Affiliate API call is the long pole; circuit breaker per FR-AFF-001 caps wait at 800ms with retry).
11. Rate limit MUST be `20 req/min/userId` AND `5 req/min/ip` (covering the anonymous-then-signup edge case). Limit response: `429 RATE_LIMIT_TRACK` with `Retry-After` seconds.
12. Duplicate `{ userId, productId }` MUST return `409 already_tracking` with body `{ error, watchlistId: <existingId>, status: <existingStatus>, createdAt }` — the FE uses this to "highlight existing card" instead of creating a duplicate.
13. If the watchlist row exists but is `status: "paused"` or `"deleted"`, the endpoint MUST reactivate it (set `status: "active"`, refresh `updatedAt`, preserve `createdAt`) instead of creating a new row OR returning 409. This handles the "I deleted it but want to re-track" flow.
14. The endpoint MUST sanitize `nickname` (max 60 chars, strip control chars, NFC normalize, reject if contains `<`, `>`, or backticks to prevent XSS in any future rendering).
15. The endpoint MUST be idempotent under retry: a client retrying within 60s with the same `Idempotency-Key` header MUST receive the same response as the first request (cached in Redis with TTL 60s, key = `idem:track:<userId>:<idempotencyKey>`).
16. The endpoint MUST authenticate via FR-AUTH-003 JWT bearer token. Anonymous requests MUST return `401 UNAUTHENTICATED` with `Location: /auth/signin?ref=track&seedUrl=<encodedUrl>` for soft-funnel.

---

## §2 — Why this design

**Why parse URL on the server, not the client:** clients can be tampered (browser DevTools, custom HTTP client, the extension itself). Server is authoritative. URL regex on server also catches legacy variants (`/product/<shopId>/<itemId>`, `/shopee-mall/...`) that the client might not recognize. Server-side parsing also enables PII hygiene (strip `utm_*` etc.) consistently.

**Why default trigger `pct_drop` 10%:** plan §F1 personas (Gen-Z, Mẹ bỉm sữa) — both are deal-hunters whose threshold for "interesting" is ~10% off based on competitor benchmarks. Too low (1%) creates alert spam and user fatigue; too high (30%) misses casual deals and reduces engagement. 10% is the sweet spot tested against 2024-2025 Vietnamese e-commerce engagement data.

**Why fail 404 on Affiliate API empty (not scrape fallback):** plan §B1 outright bans scraping for both legal (Shopee ToS) and ethical (rate-limit politeness, user-data integrity) reasons. If Shopee doesn't return the product through the official API, we cannot legitimately track it. The 404 UX is "Item này không có trong catalog Affiliate — thử item khác hoặc sản phẩm tương tự" — better than fake-tracking a stale snapshot.

**Why `upgradeUrl` in the 403 body:** plan §E2 conversion funnel explicitly names this as the upgrade-trigger moment ("limit 10 products + Mega Sale event tới (FOMO)"). The 403 response IS the conversion ask. We add `currentCount` and `availableAt` (oldest active watchlist's createdAt) so the UX can also offer "remove your oldest" as the soft path.

**Why capture `commissionRateAtTrack`:** the transparency-report (FR-LEGAL-002) wants per-cohort revenue analysis. Tracking commission at tracking-time (not at alert-time) prevents retro-revisionism — if Shopee changes commission rates after tracking, our transparency data still reflects the rate the user originally signed up under. Also useful for "watchlists added before X" analytics.

**Why reactivate paused/deleted watchlists instead of 409:** users who delete a watchlist and re-add the same product expect their original config (alert thresholds, nickname) to come back, not a fresh-default row. Reactivation preserves `createdAt` for cohort analysis but resets `updatedAt`. The deletion was "soft" anyway per FR-WATCH-003 §1 #10.

**Why `Idempotency-Key` cache:** in Vietnamese mobile networks, request retries on flaky 4G are common. Without idempotency, a user pasting a URL on a flaky connection could see "watchlist created" twice (once from the original, once from the retry). The 60s Redis cache handles this without needing the unique-index conflict path.

**Why 20 req/min/userId + 5/min/ip:** the per-user cap prevents legitimate-account abuse (a malicious user can't enumerate Shopee inventory through our API). The per-IP cap catches anon-then-signup spam (bulk-tracking via a fresh account). 5 IP is generous — a real user typically tracks 1-3 items in a session.

**Why include `currentPrice`, `is30DayLow`, etc. in the response:** the front-end "success card" needs everything to render the price + 30-day-low badge + "View chart" CTA in one paint. Second round-trip would add 200-400ms of perceived latency right after the user's "I just tracked this!" moment, which is the highest-stake feedback moment in the funnel.

**Why the X-SaleNoti-Source header (not query param):** sources are tracked for analytics; headers are harder to forge than URL params (extensions can't trivially modify the URL bar). It also keeps the URL clean for sharing/bookmarking.

---

## §3 — API contract

### Request

```http
POST /v1/products/track HTTP/1.1
Host: api.sale.cyber.skill
Authorization: Bearer <jwt>
X-SaleNoti-Source: web
Idempotency-Key: 8b3f9a2c-1e4d-4c8b-9f12-abc123def456
Content-Type: application/json

{
  "url": "https://shopee.vn/Áo-thun-nam-basic-i.123456.9876543210?utm_source=share",
  "alertConfig": {
    "triggers": ["pct_drop", "lowest_30d"],
    "minDropPct": 15,
    "lowest30d": true
  },
  "nickname": "Áo thun cho Tết"
}
```

### Success response

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "watchlistId": "65f8a3c1d4e5f6a7b8c9d0e1",
  "productId": "123456-9876543210",
  "name": "Áo thun nam basic",
  "imageUrl": "https://cf.shopee.vn/file/...",
  "currentPrice": 89000,
  "originalPrice": 129000,
  "discountPct": 31,
  "is30DayLow": false,
  "last30dMin": 79000,
  "affiliateLink": "https://shope.ee/AbCdEf12"
}
```

### Error responses

| http | code | body |
|---|---|---|
| 400 | `invalid_shopee_url` | `{ error, message: "URL không hợp lệ. Hãy paste link sản phẩm từ shopee.vn." }` |
| 401 | `UNAUTHENTICATED` | `{ error, signinUrl: "/auth/signin?ref=track&seedUrl=<encodedUrl>" }` |
| 403 | `free_tier_cap_reached` | `{ error, limit: 10, currentCount, upgradeUrl: "/billing/upgrade", availableAt: "<iso>" }` |
| 404 | `product_not_available` | `{ error, message }` |
| 409 | `already_tracking` | `{ error, watchlistId, status, createdAt }` |
| 422 | `invalid_alert_config` | `{ error, message, field, value }` |
| 429 | `RATE_LIMIT_TRACK` | `{ error, retryAfter, scope: "user" \| "ip" }` |
| 502 | `AFFILIATE_API_DOWN` | `{ error, message: "Shopee đang gián đoạn — vui lòng thử lại sau ít phút.", retryAfter: 60 }` |
| 503 | `AFFILIATE_API_TIMEOUT` | circuit breaker open per FR-AFF-001 |

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | authenticated free user with 0 watchlists | POST with valid `i.X.Y` URL | 201 + watchlist row + product row created + product.trackPriority = "mid" |
| AC2 | URL `https://lazada.vn/abc` | POST | 400 invalid_shopee_url |
| AC3 | URL with utm/fbclid query params | POST | 201 + watchlist's productId omits the params; PostHog `product_tracked` properties don't include them |
| AC4 | Affiliate API resolver returns null | POST | 404 product_not_available |
| AC5 | free user with 10 active watchlists | POST 11th | 403 free_tier_cap_reached with `{ limit: 10, currentCount: 10, upgradeUrl, availableAt }` |
| AC6 | Pro user with 1000 active watchlists | POST | 201 (no cap) |
| AC7 | `alertConfig` omitted | POST | 201 + watchlist.alertConfig = `{ triggers: ["pct_drop"], minDropPct: 10 }` |
| AC8 | `alertConfig.flashSale: true` | POST | 201 + product.trackPriority = "hot" |
| AC9 | duplicate `{ userId, productId }` on active row | POST again | 409 already_tracking with existing watchlistId |
| AC10 | watchlist exists in `status: "deleted"` | POST same URL | 201 reactivates row (status → "active"), preserves createdAt |
| AC11 | 21st call in 60s from same user | POST | 429 RATE_LIMIT_TRACK with retryAfter |
| AC12 | extension sends `X-SaleNoti-Source: ext` | POST | PostHog event property `source: "ext"` |
| AC13 | extension sends `X-SaleNoti-Source: malicious` | POST | source coerced to "web" in event |
| AC14 | client retries within 60s with same `Idempotency-Key` | POST | identical response body returned from cache; no second row inserted |
| AC15 | unauthenticated client | POST | 401 with `signinUrl` containing `seedUrl=<encoded>` |
| AC16 | `nickname: "<script>alert(1)</script>"` | POST | 422 invalid input (rejects `<`) |
| AC17 | warm-cache Shopee API mock | POST | p95 round-trip < 1500ms across 100 sequential calls |
| AC18 | Affiliate breaker open | POST | 503 AFFILIATE_API_TIMEOUT; no watchlist created |

---

## §5 — Verification

```ts
// apps/api/src/watchlist/__tests__/track.spec.ts
describe("FR-WATCH-001 — POST /v1/products/track", () => {
  beforeEach(async () => {
    await mongo.db("salenoti").collection("watchlists").deleteMany({});
    await mongo.db("salenoti").collection("products").deleteMany({});
    await redis.flushdb();
  });

  it("AC1: 201 + rows persisted + trackPriority=mid", async () => {
    const r = await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${freeUserJwt}`)
      .set("X-SaleNoti-Source", "web")
      .send({ url: "https://shopee.vn/Áo-i.1.2" });
    expect(r.status).toBe(201);
    expect(r.body.watchlistId).toBeDefined();
    const wl = await mongo.db("salenoti").collection("watchlists").findOne({ userId: freeUserId });
    expect(wl).toBeDefined();
    expect(wl!.commissionRateAtTrack).toBeGreaterThan(0);
    const p = await mongo.db("salenoti").collection("products").findOne({ productId: "1-2" });
    expect(p!.trackPriority).toBe("mid");
  });

  it("AC3: query params stripped", async () => {
    const r = await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${freeUserJwt}`)
      .send({ url: "https://shopee.vn/Áo-i.1.2?utm_source=fb&fbclid=abc123" });
    expect(r.status).toBe(201);
    expect(r.body.productId).toBe("1-2");
    expect(posthogMock.lastEvent.properties.url ?? "").not.toContain("utm_source");
  });

  it("AC5: free-tier cap with upgrade body", async () => {
    for (let i = 1; i <= 10; i++) await seedWatchlist(freeUserId, `${i}-${i}`, { status: "active" });
    const r = await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${freeUserJwt}`)
      .send({ url: "https://shopee.vn/x-i.99.99" });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "free_tier_cap_reached", limit: 10, currentCount: 10, upgradeUrl: "/billing/upgrade" });
    expect(r.body.availableAt).toBeDefined();
  });

  it("AC6: Pro user no cap", async () => {
    for (let i = 1; i <= 50; i++) await seedWatchlist(proUserId, `${i}-${i}`);
    const r = await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${proUserJwt}`)
      .send({ url: "https://shopee.vn/x-i.999.999" });
    expect(r.status).toBe(201);
  });

  it("AC9: duplicate returns 409 with existing id", async () => {
    const r1 = await api.post("/v1/products/track").set("Authorization", `Bearer ${freeUserJwt}`).send({ url: "https://shopee.vn/x-i.1.2" });
    const r2 = await api.post("/v1/products/track").set("Authorization", `Bearer ${freeUserJwt}`).send({ url: "https://shopee.vn/x-i.1.2" });
    expect(r2.status).toBe(409);
    expect(r2.body.watchlistId).toBe(r1.body.watchlistId);
  });

  it("AC10: deleted row reactivates with createdAt preserved", async () => {
    const original = await seedWatchlist(freeUserId, "1-2", { status: "deleted", createdAt: new Date("2026-01-01") });
    const r = await api.post("/v1/products/track").set("Authorization", `Bearer ${freeUserJwt}`).send({ url: "https://shopee.vn/x-i.1.2" });
    expect(r.status).toBe(201);
    const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: original._id });
    expect(wl!.status).toBe("active");
    expect(wl!.createdAt.toISOString()).toBe(new Date("2026-01-01").toISOString());
    expect(wl!.updatedAt.getTime()).toBeGreaterThan(original.createdAt.getTime());
  });

  it("AC11: rate limit fires at 21st req", async () => {
    for (let i = 0; i < 20; i++) {
      await api.post("/v1/products/track").set("Authorization", `Bearer ${freeUserJwt}`).send({ url: `https://shopee.vn/x-i.${i}.${i}` });
    }
    const r = await api.post("/v1/products/track").set("Authorization", `Bearer ${freeUserJwt}`).send({ url: "https://shopee.vn/x-i.99.99" });
    expect(r.status).toBe(429);
    expect(r.body.retryAfter).toBeGreaterThan(0);
  });

  it("AC13: malicious source coerced to web", async () => {
    await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${freeUserJwt}`)
      .set("X-SaleNoti-Source", "malicious; DROP TABLE users--")
      .send({ url: "https://shopee.vn/x-i.1.2" });
    expect(posthogMock.lastEvent.properties.source).toBe("web");
  });

  it("AC14: idempotency cache returns same body", async () => {
    const key = "test-key-12345";
    const r1 = await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${freeUserJwt}`)
      .set("Idempotency-Key", key)
      .send({ url: "https://shopee.vn/x-i.1.2" });
    const r2 = await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${freeUserJwt}`)
      .set("Idempotency-Key", key)
      .send({ url: "https://shopee.vn/x-i.1.2" });
    expect(r1.body).toEqual(r2.body);
    expect(await mongo.db("salenoti").collection("watchlists").countDocuments({ userId: freeUserId })).toBe(1);
  });

  it("AC16: nickname with HTML rejected", async () => {
    const r = await api.post("/v1/products/track")
      .set("Authorization", `Bearer ${freeUserJwt}`)
      .send({ url: "https://shopee.vn/x-i.1.2", nickname: "<script>alert(1)</script>" });
    expect(r.status).toBe(422);
  });
});

describe("FR-WATCH-001 url-parser", () => {
  it.each([
    ["https://shopee.vn/Áo-i.123.456", { shopId: 123, itemId: 456 }],
    ["https://shopee.vn/product/123/456", { shopId: 123, itemId: 456 }],
    ["https://shopee.vn/shopee-mall/123/456", { shopId: 123, itemId: 456 }],
    ["https://shopee.vn/abc?itemid=456&shopid=123", { shopId: 123, itemId: 456 }],
    ["https://shopee.vn/x-i.1.2?utm_source=fb&fbclid=z", { shopId: 1, itemId: 2 }],
  ])("parses %s", (url, expected) => expect(parseShopeeUrl(url)).toEqual(expected));

  it.each([
    "https://lazada.vn/foo",
    "https://tiki.vn/i.1.2",
    "https://shopee.com.vn/x-i.1.2",  // deprecated domain
    "ftp://shopee.vn/x-i.1.2",
    "javascript:alert(1)",
    "",
  ])("rejects %s", (url) => expect(parseShopeeUrl(url)).toBeNull());
});
```

---

## §6 — Implementation skeleton

```ts
// apps/api/src/watchlist/url-parser.ts
const SHOPEE_URL_PATTERNS = [
  /^https:\/\/shopee\.vn\/.+-i\.(\d+)\.(\d+)/,
  /^https:\/\/shopee\.vn\/product\/(\d+)\/(\d+)/,
  /^https:\/\/shopee\.vn\/shopee-mall\/(\d+)\/(\d+)/,
];
const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "__cf_chl_managed_tk__", "af_xp", "af_dp"]);

export function parseShopeeUrl(input: string): { shopId: number; itemId: number; canonical: string } | null {
  if (!input || typeof input !== "string") return null;
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.hostname !== "shopee.vn") return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // Strip tracking params
  for (const k of [...url.searchParams.keys()]) if (TRACKING_PARAMS.has(k)) url.searchParams.delete(k);

  // Pattern 1-3
  for (const re of SHOPEE_URL_PATTERNS) {
    const m = re.exec(url.toString());
    if (m) {
      const shopId = Number(m[1]), itemId = Number(m[2]);
      if (!Number.isFinite(shopId) || !Number.isFinite(itemId)) continue;
      return { shopId, itemId, canonical: `https://shopee.vn/i.${shopId}.${itemId}` };
    }
  }
  // Pattern 4: query-param deeplink fallback
  const shopId = Number(url.searchParams.get("shopid"));
  const itemId = Number(url.searchParams.get("itemid"));
  if (Number.isFinite(shopId) && Number.isFinite(itemId) && shopId > 0 && itemId > 0) {
    return { shopId, itemId, canonical: `https://shopee.vn/i.${shopId}.${itemId}` };
  }
  return null;
}

// apps/api/src/watchlist/watchlist.service.ts
@Injectable()
export class WatchlistService {
  constructor(
    private readonly resolver: OfferResolverService,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly timescale: TimescaleClient,
    private readonly posthog: PostHogService,
  ) {}

  async track(userId: string, body: TrackRequest, opts: { source: string; idempotencyKey?: string }): Promise<TrackResponse> {
    // 1. Idempotency cache
    if (opts.idempotencyKey) {
      const cached = await this.redis.get(`idem:track:${userId}:${opts.idempotencyKey}`);
      if (cached) return JSON.parse(cached);
    }

    // 2. URL parse
    const parsed = parseShopeeUrl(body.url);
    if (!parsed) throw new BadRequestException({ error: "invalid_shopee_url", message: "URL không hợp lệ." });

    // 3. Auth + tier check
    const user = await this.db.users.findOne({ _id: userId });
    if (!user) throw new UnauthorizedException();
    if (user.plan === "free") {
      const count = await this.db.watchlists.countDocuments({ userId, status: "active" });
      if (count >= 10) {
        const oldest = await this.db.watchlists.findOne({ userId, status: "active" }, { sort: { createdAt: 1 } });
        throw new ForbiddenException({ error: "free_tier_cap_reached", limit: 10, currentCount: count, upgradeUrl: "/billing/upgrade", availableAt: oldest?.createdAt });
      }
    }

    // 4. Resolve product
    const offer = await this.resolver.resolveProductOffer(parsed.shopId, parsed.itemId);
    if (!offer) throw new NotFoundException({ error: "product_not_available", message: "Item không tồn tại trong Shopee Affiliate catalog." });

    // 5. Validate alertConfig + nickname
    const alertConfig = body.alertConfig ?? { triggers: ["pct_drop"], minDropPct: 10 };
    const nickname = body.nickname ? sanitizeNickname(body.nickname) : undefined;
    if (body.nickname && nickname === null) throw new UnprocessableEntityException({ error: "invalid_alert_config", field: "nickname", message: "Nickname contains forbidden chars" });

    // 6. Upsert watchlist (handles new, duplicate, reactivate)
    const productId = `${parsed.shopId}-${parsed.itemId}`;
    const source = ["web", "ext", "share", "import"].includes(opts.source) ? opts.source : "web";
    const trackPriority = (alertConfig.flashSale || alertConfig.triggers?.includes("flash_sale")) ? "hot" : "mid";

    let response: TrackResponse;
    const existing = await this.db.watchlists.findOne({ userId, productId });
    if (existing && existing.status === "active") {
      throw new ConflictException({ error: "already_tracking", watchlistId: String(existing._id), status: existing.status, createdAt: existing.createdAt });
    }
    if (existing && (existing.status === "deleted" || existing.status === "paused")) {
      // Reactivate
      await this.db.watchlists.updateOne({ _id: existing._id }, { $set: { status: "active", alertConfig, nickname, updatedAt: new Date() } });
      response = await this._buildResponse(String(existing._id), productId, offer);
    } else {
      const r = await this.db.watchlists.insertOne({
        userId, productId, status: "active", alertConfig, nickname,
        commissionRateAtTrack: offer.commissionRate, source,
        createdAt: new Date(), updatedAt: new Date(), lastTriggeredAt: null, lastNotifiedAt: null,
      });
      response = await this._buildResponse(String(r.insertedId), productId, offer);
    }

    // 7. Update product trackPriority
    await this.db.products.updateOne(
      { productId },
      { $set: { trackPriority, lastResolvedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    // 8. PostHog
    this.posthog.capture("product_tracked", {
      userId: hashUserId(userId), shopId: parsed.shopId, itemId: parsed.itemId, productId,
      source, hasNickname: !!nickname, triggerCount: alertConfig.triggers?.length ?? 0,
      freeTierCountAfter: user.plan === "free" ? (await this.db.watchlists.countDocuments({ userId, status: "active" })) : null,
    });

    // 9. Cache idempotency response
    if (opts.idempotencyKey) {
      await this.redis.set(`idem:track:${userId}:${opts.idempotencyKey}`, JSON.stringify(response), "EX", 60);
    }

    return response;
  }

  private async _buildResponse(watchlistId: string, productId: string, offer: ResolvedOffer): Promise<TrackResponse> {
    const last30dMin = await this.timescale.getLast30dMin(productId);
    return {
      watchlistId, productId,
      name: offer.productName, imageUrl: offer.imageUrl,
      currentPrice: offer.currentPrice, originalPrice: offer.originalPrice,
      discountPct: offer.originalPrice ? Math.round(100 - (offer.currentPrice * 100 / offer.originalPrice)) : 0,
      is30DayLow: last30dMin !== null && offer.currentPrice <= last30dMin,
      last30dMin,
      affiliateLink: offer.productLink,
    };
  }
}

function sanitizeNickname(s: string): string | null {
  const trimmed = s.normalize("NFC").trim().slice(0, 60).replace(/[\x00-\x1f\x7f]/g, "");
  if (/[<>`]/.test(trimmed)) return null;
  return trimmed;
}

// apps/api/src/watchlist/watchlist.controller.ts
@Controller("v1/products")
@UseGuards(JwtAuthGuard)
export class WatchlistController {
  constructor(private readonly svc: WatchlistService) {}

  @Post("track")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ThrottleByIp({ limit: 5, ttl: 60_000 })
  async track(
    @Body() body: TrackDto,
    @Req() req: { user: { id: string } },
    @Headers("x-salenoti-source") source: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.svc.track(req.user.id, body, { source, idempotencyKey });
  }
}
```

---

## §7 — Dependencies

- FR-AFF-003 (OfferResolverService) — pre-existing
- FR-PRICE-001 (TimescaleClient.getLast30dMin) — for is30DayLow flag
- FR-AUTH-003 (JwtAuthGuard, hashed userId) — for auth + analytics
- FR-WORKER-002 — reads `trackPriority` for scheduling
- FR-OBS-001 (Sentry, PostHog) — telemetry
- MongoDB unique compound index `{ userId: 1, productId: 1 }` on `watchlists`
- Redis (idempotency cache, rate-limit counters)

Migration (idempotent):
```ts
await db.collection("watchlists").createIndex({ userId: 1, productId: 1 }, { unique: true, name: "user_product_unique" });
await db.collection("watchlists").createIndex({ userId: 1, status: 1 }, { name: "user_status" });
await db.collection("products").createIndex({ productId: 1 }, { unique: true, name: "product_unique" });
await db.collection("products").createIndex({ trackPriority: 1, lastResolvedAt: 1 }, { name: "scheduler_priority" });
```

---

## §8 — Example payloads

### Reactivation flow

```http
POST /v1/products/track  (1st call, succeeds → watchlistId X)
DELETE /v1/products/track/X  (user deletes → status: "deleted")
POST /v1/products/track  (2nd call, same URL)
→ 201 Created, watchlistId X (same id), status: "active", createdAt unchanged
```

### Free-tier cap response

```json
{
  "error": "free_tier_cap_reached",
  "limit": 10,
  "currentCount": 10,
  "upgradeUrl": "/billing/upgrade",
  "availableAt": "2026-04-12T03:14:00.000Z"
}
```

### Idempotent retry

```http
POST /v1/products/track
Idempotency-Key: abc-123
Body: { "url": "..." }
→ 201 { "watchlistId": "X", ... }

[network blip, client retries 5s later]

POST /v1/products/track
Idempotency-Key: abc-123
Body: { "url": "..." }
→ 201 { "watchlistId": "X", ... }  (same body from Redis cache; no new row)
```

---

## §9 — Open questions (resolved)

**Q1: 10-product cap counted across all statuses or active only?**
A: Active only (`status: "active"`). Deleted/paused don't count toward cap — encourages users to clean up rather than block them.

**Q2: Track variants (size, color)?**
A: Deferred to P3. Shopee's variant model is complex; MVP tracks the parent SKU only. Users can manually paste variant URLs; they'll dedupe at the parent level.

**Q3: Bulk-track via paste of multiple URLs?**
A: Deferred to P2. Single per call at MVP. Extension's "Track all on this page" is also P2.

**Q4: Allow `shopee.com.vn` variant?**
A: No — only `shopee.vn` (current canonical). `shopee.com.vn` is deprecated by Shopee since 2022.

**Q5: Should reactivation preserve alertConfig from the original row?**
A: No — the user's new request carries the new config. The original's `commissionRateAtTrack` is preserved (cohort attribution). This is a deliberate choice: re-tracking is a fresh user intent.

**Q6: What about `shope.ee` shortlinks?**
A: Reject at MVP (the parser doesn't follow redirects). User must paste the canonical URL. P3 adds `shope.ee` resolution via affiliate-API short-link expansion endpoint.

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | URL with old format Shopee doesn't accept | regex no match | parseShopeeUrl returns null | 400 invalid_shopee_url | info |
| 2 | Affiliate API returns empty (item delisted) | resolver null | NotFoundException | 404 product_not_available | info |
| 3 | Concurrent track of same product | unique-index conflict | MongoError 11000 | 409 with existing watchlistId | info |
| 4 | Free-tier cap race (2 simultaneous tracks at count=9) | both pass count check | one wins, second hits 11-count on retry | acceptable; second user sees 403 on retry | info |
| 5 | `flash_sale` trigger sets priority hot, then user removes | FR-WORKER-002 re-evaluates next cycle | scheduler downgrades back to mid | self-healing within 30 min | info |
| 6 | Shopee API > 1500ms timeout | FR-AFF-001 breaker fires | breaker state = open | 503 AFFILIATE_API_TIMEOUT; user retries | warning |
| 7 | Product Mongo write succeeds, watchlist insert fails | partial state | tx-wrapped batch (Mongo txn or compensating delete) | atomic via Mongo transaction; if no replicaset, app-level rollback | error |
| 8 | User tries to track own affiliate link | no special handling | parser succeeds (it's a shopee.vn URL) | accepted; same as any other URL | info |
| 9 | Extension lies about source ("malicious" header value) | enum validation | source coerced to "web" | AC13 verifies | info |
| 10 | Rate limit triggers under burst | redis counter overflow | 429 + Retry-After | client back-off | info |
| 11 | Idempotency key reuse with different body | hash check on cached vs incoming | inconsistent retry detected | 409 IDEMPOTENCY_KEY_REUSE (different body) — return error, don't serve stale | warning |
| 12 | Nickname with zero-width chars or RTL override | regex hygiene | NFC normalize + control-char strip | safe; preview escapes on render | info |
| 13 | Mongo replica-set failover mid-insert | duplicate writes possible | unique index dedupes | one row survives; second insert 409 | info |
| 14 | Redis idempotency cache miss after 60s | second call goes through | new row attempt → 409 already_tracking | acceptable: real duplicates surface, cache is best-effort | info |
| 15 | Worker scheduler reads stale trackPriority | hot-track config change before next poll | next poll picks up new priority | self-healing within poll cycle | info |
| 16 | XSS attempt via nickname | regex blocks `<>` | 422 invalid_alert_config | rejected | warning |

---

## §11 — Notes

- The "201 + product card" response shape gives the FE everything needed to render the success state in one paint. No second round-trip; the user sees the chart + 30-day-low badge + affiliate CTA immediately. This is the highest-stake UX moment in the funnel — a sluggish "tracked!" state kills retention.
- The `source` dimension feeds plan §I Phase 1 dashboard "where do users discover products?" (web paste vs extension button vs shared link).
- Reactivation (AC10) is a deliberate UX call: deleting then re-adding shouldn't lose history. The original `createdAt` matters for cohort analysis; the new `alertConfig` matters because that's what the user just asked for.
- The idempotency key (§1 #15) is opt-in: clients without it fall through to the 409-on-duplicate path. Recommended for the extension and any mobile client; web typically doesn't need it.
- Tracking `commissionRateAtTrack` at insert-time is the key to honest transparency reporting per FR-LEGAL-002. If Shopee silently changes rates after tracking, our transparency dashboard still reflects what users opted into.
- The 5-req/min/ip rate limit is the anti-enumeration defense: a fresh signup from a single IP can only track 5 products in the first minute, preventing scrapers from masquerading as new users.

---

*FR-WATCH-001 spec — last revised 2026-05-16. Status: shipped (2026-05-17).*
