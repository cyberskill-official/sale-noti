---
id: FR-PRICE-002
title: "`GET /v1/products/:productId/history` — chart-ready time-series API with server-side downsampling + 5-min cache + watchlist-or-public auth"
module: PRICE
priority: MUST
status: shipped
shipped: 2026-05-17
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
related_frs: [FR-PRICE-001, FR-WATCH-001, FR-WATCH-003, FR-GROW-002, FR-AFF-003]
depends_on: [FR-PRICE-001, FR-WATCH-001]
blocks: []
effort_hours: 4

new_files:
  - apps/api/src/price/history.service.ts
  - apps/api/src/price/history.controller.ts
  - apps/api/src/price/price.module.ts
  - apps/api/src/price/__tests__/history.spec.ts
modified_files: []
allowed_tools:
  - "file_read/write apps/api/**"
  - "bash pnpm test"
disallowed_tools:
  - "return raw observations for ranges > 7d (size blows up; downsample at server)"
  - "expose product history a user does not track AND that is not marked public (privacy default)"
  - "cache > 10 min (flash sale prices change too fast)"
  - "include commissionRate in any history response field (FR-LEGAL-002 §1 #10)"
risk_if_skipped: "Plan §J Phase 1 'Price history chart (last 30 days)' is in the web app deliverable list and is the single feature most cited in user-research interviews from the plan period. Without history, the alert experience is 'price changed' without context — users can't see whether 89K from 99K is a real deal or yesterday's normal. Public deal pages (FR-GROW-002) and Mega Sale landings (FR-GROW-003) both need this endpoint for the inline sparkline."

---

## §1 — Description (BCP-14 normative)

The price service MUST expose a paginated, downsampled history endpoint with strict auth (watchlist OR public-deal) and bounded cache.

1. **MUST** expose `GET /v1/products/:productId/history?range=7d|30d|90d&granularity=raw|30m|1h|6h|1d`. Path param `productId` matches `^\d+-\d+$` (composite `<shopId>-<itemId>`).
2. **MUST** default `range=30d`, `granularity=1h` when params absent. Default choice optimizes for the dashboard chart UX (30-day view at hourly resolution = ~720 points, comfortable for line-chart rendering on mobile).
3. **MUST** restrict `granularity=raw` to `range ≤ 7d`. Range > 7d with `granularity=raw` → 400 `raw_requires_7d`. Reason: raw observations at hot-tier 30-min cadence produce ~1500 points over 30 days; mobile chart libraries (Recharts, Chart.js) start degrading visibly past 1000 points.
4. **MUST** route bucketed granularities (`30m`, `1h`, `6h`, `1d`) through `timescale.getBucketedHistory()` (FR-PRICE-001 §1 #6) which queries the `price_history_30min_agg` continuous aggregate — sub-100ms p95 on the underlying aggregate, scales independent of raw row count.
5. **MUST** authorize: caller MUST satisfy ONE of:
   - Hold an `active` or `paused` (not `deleted`) watchlist on this `productId`, OR
   - Be admin (header `X-Admin-Token` matching `ADMIN_TOKEN` env — used only for ops scripts), OR
   - The product MUST have `publicDealAt: <date>` set in MongoDB (set by admin tool for `/deal/<slug>` public pages — FR-AFF-003 §1 schema reserves the field).

   Otherwise 403 `forbidden`. The watchlist OR public-deal alternation is the privacy guard: random users can't enumerate product history by guessing productIds.

6. **MUST** return shape `{ productId, range, granularity, points: [{ t: ISO8601, p: integer-VND, p_min, p_max }] }`. `p` is the bucket midpoint price (average of bucket's price observations); `p_min`/`p_max` enable candle-style charts at zoom level if FE wants.
7. **MUST** cache responses 5 min in Redis (`history:<productId>:<range>:<granularity>`). Invalidate immediately on each new `price_history` insert via Redis pubsub `price_history_invalidate` channel published by FR-AFF-003 resolver after every successful Timescale write. Cache TTL is the upper bound; pubsub invalidation is the freshness signal for hot products.
8. **MUST** complete p95 < 200 ms for the common case (30d / 1h granularity = ~720 points × ~32 bytes per point ≈ 23 KB response).
9. **MUST** emit PostHog event `price_history_viewed` with `{ productId, range, granularity, source: "web" | "ext" | "deal-page", cached: bool, latency_ms }`. `productId` is public (Shopee shop+item ID, not PII); userId is NOT included to keep the event store cohort-aggregatable.
10. **MUST** rate-limit per authenticated user at 60 req/min/userId; anonymous (public-deal access) at 30 req/min/IP `/24`. Excess returns 429 with `Retry-After: 60`.
11. **MUST** reject `range > 90d` → 400 `range_too_large` (we don't surface deeper history at MVP; TimescaleDB retention is 730 days but the chart UX caps at 90 to avoid unbounded query cost).
12. **MUST** support pubsub-driven cache invalidation: when `FR-AFF-003 resolveProductOffer` writes a new `price_history` row, it publishes `price_history_invalidate:<productId>` to Redis; this service's Redis subscription drops all `history:<productId>:*` keys.
13. **MUST NOT** include `commissionRate` in the response. The history endpoint is product-price-focused; commission is metadata for the Transparency Report aggregator, not for user-facing surfaces.

---

## §2 — Why this design

**Why server-side downsampling (not client-side):** 30 days × ~50 observations/day = 1500 raw points. Pushing 1500 × 32 bytes = 48 KB to a mobile client (3G/4G in VN) over the wire is wasteful; the chart library has to filter/sample anyway. Server downsamples to ~720 points (1h granularity = 24 buckets/day × 30 days), keeping wire size ~23 KB, render fast, and the continuous aggregate query stable at ~50ms.

**Why range ceiling at 90 days:** plan §C3 PriceHistory retention is 730 days at the TimescaleDB layer — but exposing 730 days in the chart UX is overkill at MVP. 90 days covers the rational-waiter persona ("the last 3 months tell me whether this is at the bottom"). Deeper history is FR-PRICE-003 ML feature (P4) for deal-score regression training, where it lives behind a different API.

**Why `granularity: raw` only for ≤ 7 days:** raw 30-min ticks over 30 days is 1440 points; mobile chart libraries degrade past 1000. Raw 7-day is ~336 points — comfortable. The forced downsample for 30d/90d is the right ergonomic trade-off; serious users wanting raw data can paginate by 7-day chunks.

**Why watchlist-or-public auth (not "always public" or "always require auth"):** 
- "Always public" leaks the SaleNoti tracking dataset as a free-to-scrape API for competitors.
- "Always require auth" prevents the public deal page (FR-GROW-002) from showing inline sparklines for share-link visitors who haven't signed up yet — kills the SEO acquisition funnel.
- The hybrid: explicit opt-in via the admin tool's `publicDealAt` for SEO-visible products + watchlist gating for everything else.

**Why 5-min cache with pubsub invalidation:** balances freshness against load. New observations on hot-tier products invalidate immediately (pubsub); mid/low-tier products see at most 5-min staleness. Without pubsub, freshness would lag by the TTL on hot products; without TTL, a Redis subscription gap would serve stale data indefinitely. The combo gives correctness under both modes.

**Why 60 req/min/user + 30 req/min/IP for anonymous:** legitimate dashboard use is 1-2 history calls per product view; a user looking at 5 products in a minute is 5-10 calls. 60/min covers heavy comparison-shopping. Anonymous (public deal page) is bot-like at scale; 30/min is generous for human exploration.

**Why `p`, `p_min`, `p_max` per bucket (not just `p`):** chart libraries support candle/range visualizations. Exposing the bucket's min/max enables future "show high-low band over the period" UX without an API change. The extra bytes (8 per point × 720 points = ~6 KB) are negligible.

**Why `userId` NOT in PostHog event:** the chart is a read-heavy surface and aggregating "how many distinct users view product X" is the analytics question we care about (popularity proxy). Including `userId` would bloat the event count and create unnecessary PostHog cardinality without analytic gain. PostHog's session-level grouping handles cohort questions.

**Why pubsub channel scoped per productId (not global):** keeps the subscriber's invalidation cost bounded. At 10K products × 50 obs/day = 500K invalidations/day across all keys; per-product scoping means the Redis pubsub message is small and the subscriber's `redis.del()` call drops 1-5 keys (one per granularity for that product).

---

## §3 — API contract

```http
GET /v1/products/123-456/history?range=30d&granularity=1h HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7...
```

Success:

```http
HTTP/1.1 200 OK
{
  "productId": "123-456",
  "range": "30d",
  "granularity": "1h",
  "points": [
    { "t": "2026-04-16T00:00:00Z", "p": 119000, "p_min": 119000, "p_max": 119000 },
    { "t": "2026-04-16T01:00:00Z", "p": 119000, "p_min": 119000, "p_max": 119000 },
    { "t": "2026-04-17T03:00:00Z", "p": 89000, "p_min": 89000, "p_max": 99000 }
  ]
}
```

Errors:

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"raw_requires_7d"}` | `granularity=raw` with `range > 7d` |
| 400 | `{"error":"range_too_large"}` | `range > 90d` |
| 400 | `{"error":"invalid_productId"}` | productId doesn't match `^\d+-\d+$` |
| 403 | `{"error":"forbidden"}` | no watchlist on product AND not public |
| 429 | `{"error":"rate_limit","retryAfter":60}` | rate limit hit |

---

## §4 — Acceptance criteria

1. 30d/1h request returns ~720 points (24×30 ± a few for sparse mid/low tiers); count is in the bucket-aware range.
2. 7d/raw request returns raw points; range > 7d with `granularity=raw` → 400 `raw_requires_7d`.
3. Cache hit on second call within 5 min → response < 50 ms.
4. New `price_history` insert → pubsub published → cache invalidated within 100 ms.
5. User without watchlist on the product → 403 `forbidden`.
6. Public deal product (`publicDealAt` set) → accessible without watchlist or auth.
7. PostHog event captures `range`, `granularity`, `cached`, `latency_ms`; NO `userId`.
8. p95 < 200 ms for typical 30d/1h response.
9. Rate limit 60 req/min/user enforced (61st returns 429).
10. Anonymous user (public deal page) rate-limit 30 req/min/IP enforced.
11. Range `91d` → 400 `range_too_large`.
12. Invalid productId format `abc-xyz` → 400 `invalid_productId`.
13. Response excludes `commissionRate` field anywhere in the JSON.
14. Bucket granularity `30m` request returns `~1440 buckets/30d = 1440 points` (raw observation count × 30 min / 30 min = 1 per minute average — but actually raw-tier products only have ~50/day observations, so 30m buckets aggregate empty buckets correctly).
15. Empty history (product has no `price_history` rows) → 200 with `points: []`.

---

## §5 — Verification

```ts
// apps/api/src/price/__tests__/history.spec.ts
describe("FR-PRICE-002 — history chart API", () => {
  it("AC1: 30d/1h returns ~720 points", async () => {
    await seedPriceHistory({ productId: "p1", days: 30, observationsPerDay: 48 });
    await seedWatchlist({ userId: testUser, productId: "p1" });
    const r = await api.get("/v1/products/p1/history?range=30d&granularity=1h").as(testUser);
    expect(r.body.points.length).toBeGreaterThan(700);
    expect(r.body.points.length).toBeLessThan(740);
  });

  it("AC2: raw > 7d rejected", async () => {
    const r = await api.get("/v1/products/p1/history?range=30d&granularity=raw").as(testUser);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("raw_requires_7d");
  });

  it("AC3+AC4: cache hit + pubsub invalidate", async () => {
    await api.get("/v1/products/p1/history").as(testUser);
    expect(await redis.exists("history:p1:30d:1h")).toBe(1);
    const t0 = Date.now();
    const r = await api.get("/v1/products/p1/history").as(testUser);
    expect(Date.now() - t0).toBeLessThan(50);
    await redis.publish("price_history_invalidate", "p1");
    await sleep(150);
    expect(await redis.exists("history:p1:30d:1h")).toBe(0);
  });

  it("AC5+AC6: auth (watchlist or public)", async () => {
    await mongo.db("salenoti").collection("products").updateOne({ shopId: 1, itemId: 1 }, { $unset: { publicDealAt: "" } });
    const denied = await api.get("/v1/products/1-1/history").as(otherUser);
    expect(denied.status).toBe(403);
    await mongo.db("salenoti").collection("products").updateOne({ shopId: 1, itemId: 1 }, { $set: { publicDealAt: new Date() } });
    const allowed = await api.get("/v1/products/1-1/history").as(otherUser);
    expect(allowed.status).toBe(200);
  });

  it("AC7: PostHog event excludes userId", async () => {
    const events = capturePostHog();
    await api.get("/v1/products/p1/history").as(testUser);
    const ev = events.find((e) => e.event === "price_history_viewed");
    expect(JSON.stringify(ev)).not.toContain(testUser._id);
    expect(ev!.properties.latency_ms).toBeGreaterThan(0);
  });

  it("AC9: 61st call/min → 429", async () => {
    for (let i = 0; i < 60; i++) await api.get(`/v1/products/p${i}/history`).as(testUser);
    const r = await api.get("/v1/products/p99/history").as(testUser);
    expect(r.status).toBe(429);
  });

  it("AC11: range > 90d rejected", async () => {
    const r = await api.get("/v1/products/p1/history?range=180d").as(testUser);
    expect(r.status).toBe(400);
  });

  it("AC12: invalid productId rejected", async () => {
    const r = await api.get("/v1/products/abc-xyz/history").as(testUser);
    expect(r.status).toBe(400);
  });

  it("AC13: commissionRate absent from response", async () => {
    const r = await api.get("/v1/products/p1/history").as(testUser);
    expect(JSON.stringify(r.body)).not.toMatch(/commissionRate/i);
  });

  it("AC15: empty history → 200 with points: []", async () => {
    await seedWatchlist({ userId: testUser, productId: "p_empty" });
    const r = await api.get("/v1/products/p_empty/history").as(testUser);
    expect(r.status).toBe(200);
    expect(r.body.points).toEqual([]);
  });
});
```

---

## §6 — Implementation skeleton

```ts
@Injectable()
export class HistoryService {
  constructor(@Inject("OBS_POSTHOG") private readonly posthog: any) {}

  async getHistory(args: {
    userId: string | null;
    productId: string;
    range: "7d" | "30d" | "90d";
    granularity: "raw" | "30m" | "1h" | "6h" | "1d";
    source: "web" | "ext" | "deal-page";
  }): Promise<HistoryResult> {
    const t0 = Date.now();
    if (args.granularity === "raw" && args.range !== "7d") {
      throw new BadRequestException({ error: "raw_requires_7d" });
    }
    if (!(await this.hasActiveWatchlistOrPublic(args.userId, args.productId))) {
      throw new ForbiddenException({ error: "forbidden" });
    }
    const cacheKey = `history:${args.productId}:${args.range}:${args.granularity}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      this.observe(t0, args, true);
      return parsed;
    }
    const from = new Date(Date.now() - RANGE_MS[args.range]);
    const points = args.granularity === "raw"
      ? (await timescale.getHistory(args.productId, from, new Date())).map((r) => ({ t: r.observed_at, p: r.price, p_min: r.price, p_max: r.price }))
      : await timescale.getBucketedHistory({ productId: args.productId, from, bucketInterval: BUCKET[args.granularity] });
    const out = { productId: args.productId, range: args.range, granularity: args.granularity, points };
    await redis.setex(cacheKey, 300, JSON.stringify(out));
    this.observe(t0, args, false);
    return out;
  }

  async invalidateCache(productId: string) {
    const keys = await redis.keys(`history:${productId}:*`);
    if (keys.length) await redis.del(...keys);
  }

  private async hasActiveWatchlistOrPublic(userId: string | null, productId: string): Promise<boolean> {
    const m = productId.match(/^(\d+)-(\d+)$/);
    if (!m) return false;
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId: Number(m[1]), itemId: Number(m[2]) });
    if (product?.publicDealAt) return true;
    if (!userId) return false;
    const wl = await mongo.db("salenoti").collection("watchlists").findOne({
      userId: new ObjectId(userId), productId, status: { $in: ["active", "paused"] },
    });
    return Boolean(wl);
  }

  private observe(t0: number, args: any, cached: boolean) {
    this.posthog.capture("price_history_viewed", {
      productId: args.productId, range: args.range, granularity: args.granularity,
      source: args.source, cached, latency_ms: Date.now() - t0,
    });
  }
}
```

Subscriber to the pubsub invalidation:

```ts
@Injectable()
export class HistoryCacheInvalidator implements OnModuleInit {
  constructor(private readonly history: HistoryService) {}
  async onModuleInit() {
    const sub = redis.duplicate();
    await sub.subscribe("price_history_invalidate");
    sub.on("message", async (_channel, productId) => {
      await this.history.invalidateCache(productId);
    });
  }
}
```

---

## §7 — Dependencies

- **External:** none.
- **Internal:** FR-PRICE-001 (TimescaleClient + continuous aggregate), FR-WATCH-001 (watchlist auth check), FR-AFF-003 (publishes the `price_history_invalidate` channel after each Timescale write).
- **Infrastructure:** Redis pubsub support (single Redis instance, not Redis Cluster — pubsub is per-shard).

---

## §8 — Example payloads

(see §3)

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: SVG sparkline endpoint (server-rendered)?** Resolved → no; FE renders client-side. Server-rendered SVG would couple chart styling to backend and break the FE design system.
- **Q2: WebSocket push for live chart updates?** Resolved → P3 (FR-PRICE-003 candidate). MVP poll on 5-min cache + pubsub invalidation is sufficient for the dashboard refresh cadence.
- **Q3: Currency conversion (VND → USD for diaspora users)?** Resolved → P3 (FR-AFF-009 multi-region). VND-only at P1 keeps the chart trivially correct.
- **Q4: Should chart show alert markers (when a watchlist trigger fired)?** Resolved → P2 (FR-NOTIF-005 candidate). Mark cooldown-anchor timestamps inline; out of scope at MVP.
- **Q5: Show "Now / Today's range" overlay?** Resolved → P2 FE feature; this endpoint already returns latest observation as the last `points[]` entry, FE renders the overlay client-side.
- **Q6: What if `publicDealAt` is set but the product is deleted (deletedAt also set)?** Resolved → `publicDealAt` takes precedence (admin tool's intent); history returns normally. The admin tool is responsible for un-setting `publicDealAt` when retiring a public deal.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Aggregate view stale > 15 min | Timescale logs | Slight chart lag (up to 15 min) | Restart refresh policy; OBS alert on stale-aggregate |
| Product has no history yet | empty array return | UI shows "Đang thu thập dữ liệu…" placeholder | OK; AC15 |
| Cache poisoning (different user payload) | n/a — key is by `productId` not by user | Same response across users (no user-specific data in response) | OK |
| Range > 90d typo | regex validate | 400 `range_too_large` | None — AC11 |
| Cache invalidate race (Mongo write before pubsub) | rare; next read gets fresh | OK | None |
| Public deal page bypass (productId enumeration) | `publicDealAt` is admin-set field | Only intentionally-public products accessible | Admin tool review |
| User watching paused → still sees history | yes (intentional; `paused` status still passes auth) | OK | None |
| Granularity `30m` on 90d | up to 4320 points returned | Acceptable but slower; UI warns or auto-coarsens | None at MVP; UI guides |
| Time-zone in `t` field | UTC always | OK | Documented |
| Empty agg view (Timescale not refreshed) | rows empty | UI shows partial | Next refresh fixes |
| pubsub subscriber dies mid-flight | new pubsub messages missed → cache stays stale up to 5 min | OK; TTL is fallback | OnModuleInit reconnects; OBS alert on subscriber disconnect |
| Cache key collision (different products with same suffix) | impossible — full productId is in the key | OK | None |
| `productId` URL-decode confusion | regex match before parse | 400 `invalid_productId` | AC12 |
| Anonymous user spamming public deal pages | rate-limit 30/min/IP | 429 | Future: Cloudflare WAF on suspicious patterns |
| Timescale outage | aggregate query times out | 503 `service_unavailable` | OBS alert; UI shows "Chart temporarily unavailable" |

---

## §11 — Notes

- The 5-min cache + pubsub invalidate combo is the textbook pattern for write-frequency-bounded reads. Without invalidation, freshness lags TTL. Without TTL, dead subscribers serve stale forever. The combo gives correctness under both modes.
- The history endpoint is the **public** surface for SEO inbound traffic via FR-GROW-002 deal pages. The `publicDealAt` gating is the admin lever for which products SEO can index; everything else stays watchlist-gated.
- Plan §A3 principle 4 ("open source revenue model"): the chart endpoint + `evaluateTriggers` together let any user audit any alert. They can fetch the history endpoint for the productId in question, then replay the trigger eval rules against the historic data points. This makes alert correctness reproducible end-to-end.
- The `30m` granularity is the same as TimescaleDB's continuous aggregate base bucket — querying `30m` returns the agg rows directly without bucket-merge math. This is the cheapest read path; we expose it for completeness.

---

*End of FR-PRICE-002. Status: shipped (2026-05-17). Last expanded: 2026-05-16.*
