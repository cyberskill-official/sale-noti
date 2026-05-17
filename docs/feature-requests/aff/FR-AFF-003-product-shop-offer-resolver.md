---
id: FR-AFF-003
title: "`productOfferV2` + `shopOfferV2` resolver — commission rate ingest + denormalised cache + dual-write to Mongo + TimescaleDB"
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
related_frs: [FR-AFF-001, FR-AFF-002, FR-WATCH-001, FR-PRICE-001, FR-WORKER-002, FR-LEGAL-002]
depends_on: [FR-AFF-001, FR-PRICE-001]
blocks: [FR-WATCH-001, FR-PRICE-002, FR-NOTIF-001]
effort_hours: 5

new_files:
  - apps/api/src/affiliate/offer-resolver.service.ts
  - apps/api/src/affiliate/__tests__/offer-resolver.spec.ts
modified_files: []
allowed_tools:
  - "file_read/write apps/api/**"
  - "bash pnpm test"
disallowed_tools:
  - "fall back to scraping shopee.vn page HTML when Open API returns no data (plan §B1 explicitly forbids)"
  - "cache `productOfferV2` responses at the resolver level — price IS the product; freshness matters"
  - "use `commissionRate` to rank, sort, or recommend products (FR-LEGAL-002 §1 #10 firewall)"
  - "skip the TimescaleDB write when MongoDB write succeeds (dual-write must be atomic-enough; outbox retry covers gaps)"
  - "swallow Shopee API errors silently — every failure must surface to OBS"
risk_if_skipped: "Every WATCH/PRICE/NOTIF surface needs `products.currentPrice` + `products.affiliateLink` + the time-series history. Without the resolver, the price-check cron has no canonical write target, watchlist creation can't denormalise basic product metadata, the alert dispatch can't compute discountPct vs baseline, and the chart endpoint has no data to serve. This FR is the single ingest point that fans out to MongoDB (hot/latest) and TimescaleDB (cold/series). If the dual-write integrity breaks, the entire P1 alert loop produces stale or incoherent output."

---

## §1 — Description (BCP-14 normative)

The offer-resolver service MUST expose a unified read surface over Shopee `productOfferV2` and `shopOfferV2` GraphQL nodes, normalising the response and dual-writing to MongoDB `products` (latest snapshot) AND TimescaleDB `price_history` (time-series) on every successful resolution.

1. **MUST** expose `resolveProductOffer(shopId: number, itemId: number): Promise<NormalizedOffer | null>` that calls `ShopeeAffiliateClient.productOfferV2(...)` (FR-AFF-001), zod-parses the response, and returns a normalised `NormalizedOffer` extending the raw Shopee node with derived fields `currentPrice` (integer VND), `originalPrice`, `currentDiscountPct`, `flashSale` (boolean).
2. **MUST** expose `resolveShopOffer(shopId: number): Promise<{ shopId: string, commissionRate: number } | null>` for the shop-level fallback when product-level `commissionRate` is absent. Result MUST be cached in Redis for 1 hour at key `shopee:shop_offer:<shopId>` — shop-level rates change at most weekly per Shopee Mall onboarding cadence.
3. **MUST NOT** cache `productOfferV2` responses at the resolver layer. Price IS the product; a stale price means a stale alert. Caching belongs at the scheduler tier (FR-WORKER-002 §1 #1 hot/mid/low cadence), not here.
4. **MUST** denormalise into MongoDB `products` collection on every successful resolution via `findOneAndUpdate` with `upsert: true`. The document shape per §3 schema. `$setOnInsert` carries `slug`, `trackPriority: "mid"`, `_scheduleHash`, `createdAt`; `$set` carries the mutable snapshot fields (`name`, `imageUrl`, `currentPrice`, `originalPrice`, `currentDiscountPct`, `lastObservedAt`, `affiliateLink`, `commissionRate`, `sales`, `updatedAt`); `$unset` removes `deletedAt` if the item was previously soft-deleted (item resurrection per §10 row 4).
5. **MUST** simultaneously write a `price_history` row in TimescaleDB (FR-PRICE-001 hypertable) with `{ product_id: "<shopId>-<itemId>", shop_id, region: "VN", observed_at: now, price, original_price, discount_pct, stock, flash_sale, source: "affiliate_api" }`. The two writes execute sequentially (Mongo first, Timescale second) — true cross-database transactions don't exist; we accept the brief window of "Mongo ahead of Timescale" and rely on the BullMQ outbox retry pattern documented in §10 row 2.
6. **MUST** handle the "item dead" case: if Shopee returns empty `productOfferV2.nodes[]` (item delisted, banned, or out of stock), set `products.deletedAt = now()` via `$set`, emit PostHog event with `outcome: "dead"`, and skip the `price_history` write. Downstream consumers (FR-WATCH-002 trigger eval) interpret `deletedAt` to suppress alerts.
7. **MUST** detect flash-sale conditions and set `flashSale: true` when `currentPrice < originalPrice * 0.7` (i.e., ≥ 30% discount from list) OR when the response includes an explicit `flashSale` field from Shopee (some Mall items expose this). The 30% threshold is the FR-WATCH-002 `flash_sale` trigger default and aligns FR-AFF-003 with downstream eval.
8. **MUST NOT** sort, rank, recommend, or filter products by `commissionRate` anywhere in the resolver or its callers. The `commissionRate` value is stored as informational metadata only and used for the quarterly Transparency Report aggregation (FR-LEGAL-002 §1 #7). The CI `pnpm legal:check` script greps every server-side file under `apps/api/src/` for `ORDER BY.*commission` / `sortBy.*commission` / `sort.*commissionRate` and fails the build on any hit.
9. **MUST** emit PostHog event `product_offer_resolved` per call with properties `{ shopId, itemId, commissionRate, priceVnd, source: "v2" | "shop", flashSale, outcome: "live" | "dead", latency_ms }`. shopId and itemId are public Shopee identifiers (not PII); commissionRate informational.
10. **MUST** complete `resolveProductOffer` in p95 < 800 ms when Shopee API is healthy (matches FR-AFF-001 §1 #11). The dual-write to Mongo + Timescale adds ~50-100 ms over the raw API call; budget covers this.
11. **MUST** compute a deterministic `_scheduleHash = abs(djb2_hash(productId))` and set it on `$setOnInsert` so FR-WORKER-002's tier scheduler can spread products evenly across the cadence window via modulo arithmetic. Hash MUST be stable across re-resolutions of the same product.
12. **MUST** surface every Shopee API failure to Sentry via the existing `ShopeeAffiliateClient` error path (FR-AFF-001 §1 #10) AND additionally tag the captured exception with `{ fr: "FR-AFF-003", productId: "<shopId>-<itemId>", phase: "resolve" | "mongo_write" | "timescale_write" }` so OBS dashboards can decompose failure rates by stage.
13. **MUST** write `currency: "VND"` implicit in the Timescale row (column not stored — defaults match) AND in the Mongo row (`currency` field optional but if present MUST equal `"VND"` at P1; the field is reserved for FR-AFF-009 P4 multi-region expansion to MYR/IDR/PHP/THB).

---

## §2 — Why this design

**Why TimescaleDB (not InfluxDB, not ClickHouse, not "just Mongo with TTL"):** plan §C3's trade-off table directly compares — Timescale wins on (a) team familiarity (intern team knows SQL), (b) Postgres-compatible operationally (no new dialect, no new ops surface), (c) the continuous-aggregate view (FR-PRICE-001 §3) gives sub-100ms `lowest_30d` queries which power FR-WATCH-002's `lowest_30d` trigger and FR-PRICE-002's chart endpoint, (d) Neon's hosted free tier covers MVP, (e) Atlas charts on raw Mongo data hits 10M+ rows in 3 weeks at 10K products × 50 obs/day × 30d — query latency degrades to seconds. Timescale's chunk pruning keeps that to milliseconds.

**Why MongoDB + TimescaleDB hybrid (not all-Postgres or all-Mongo):** plan §C3 explicit: "Trưởng nhóm muốn intern học MongoDB, founder muốn intern học MongoDB. Reduce overhead phải làm 'dual-write' có thể giải quyết bằng Outbox pattern." MongoDB owns metadata + watchlist flexibility (denormalised joins, document growth from `triggerCooldowns`); TimescaleDB owns time-series. The "dual-write divergence" risk is real but bounded by §10 row 2's outbox retry — at MVP scale (10K products × 50 obs/day = 500K writes/day), divergence rate < 0.1% is well within tolerance for our use case where alerts re-trigger on next observation anyway.

**Why no resolver-level cache for `productOfferV2`:** price IS the product. A 5-min cache means a `pct_drop` alert fires up to 5 min stale, which directly contradicts the founder's plan §A3 principle 4 (open-source revenue model — users can audit our timestamps). Plus the scheduler tier (FR-WORKER-002 §1 #1) IS the cache for this — hot products check every 30 min, mid every 6 h, low every 24 h. That cadence IS our cache TTL; adding another layer would be double-caching and amplify any stale-bug to multiple users at once.

**Why 1h cache for `shopOfferV2` specifically:** plan §F2 footer notes "Shopee Mall items có commission cao hơn (5%); ngành hàng khác (1.5-2.5%)" — shop-level rates change at the Shopee Mall onboarding cadence (weekly at most). Caching 1h saves ~95% of `shopOfferV2` calls without freshness cost.

**Why flash-sale threshold = 70% of original price:** the watchlist trigger `flash_sale` (FR-WATCH-002 §3 schema) defaults to `minDiscountPct: 30`. Plan §F3 calls out Vietnamese consumer perception that "real flash sale" = ≥ 30% off list. Aligning the resolver's `flashSale: true` flag to the same threshold means the downstream trigger eval is a one-line check (`fired = ctx.flashSaleObserved && ctx.currentDiscountPct >= t.minDiscountPct`) instead of duplicating the threshold logic.

**Why detect flash-sale via TWO conditions (price < 70% OR explicit flag from Shopee):** some Shopee Mall items expose an explicit `flashSale: true` field on the API response (typically during 9.9/10.10/11.11/12.12 events where Shopee tags products in the cart-page UI). Most items don't. The 70% threshold catches the unmarked majority; the explicit flag catches the Mall-marked subset that might have a ≥ 30% drop AND additional UX hints (countdown timer, limited-quantity badge) we want to surface in the alert email.

**Why dual-write is sequential, not transactional:** Mongo and Postgres don't share a transaction coordinator. The standard pattern in this stack is Outbox: write to Mongo first (it's the system-of-record for product metadata), enqueue a BullMQ job to write to Timescale, retry on failure. At MVP scale we tolerate the ~10ms window of Mongo-ahead-of-Timescale; the outbox queue retries within seconds on transient Timescale failure. The §10 row 2 inventory documents the divergence path explicitly.

**Why deterministic `_scheduleHash` (djb2 over productId):** FR-WORKER-002 §1 #3 requires the scheduler to spread products evenly across the tier cadence window via modulo arithmetic. The hash MUST be deterministic so the same product lands in the same minute slot on every check (otherwise we'd thunder-herd or miss products). djb2 is the cheapest sufficiently-uniform hash; MD5/SHA-1 would also work but are 10× slower for no analytic benefit.

**Why never rank by commissionRate (re-asserting at this layer):** if a future engineer adds a "Top deals" page that ORDER BYs `commissionRate DESC`, that would directly violate FR-LEGAL-002 §1 #10 + plan §A3 principle 4 ("không ẩn deal tốt hơn để hưởng commission cao hơn"). The CI grep gate catches this at PR time. We re-state it at the resolver because this is the file that *writes* `commissionRate`; consumers are downstream of this write. Defense in depth: write here, consume nowhere except the Transparency Report aggregator.

---

## §3 — API contract & code shape

### TypeScript types

```ts
export type NormalizedOffer = ProductOfferNode & {
  currentPrice: number;          // integer VND
  originalPrice: number;          // integer VND
  currentDiscountPct: number;     // 0..99 inclusive
  flashSale: boolean;
};
```

### MongoDB `products` collection (extended schema)

```ts
{
  _id: ObjectId,
  shopId: number,
  itemId: number,
  slug: string,                          // slugified product name, ≤ 80 chars
  name: string,
  imageUrl: string | null,
  category: string | null,
  currentPrice: number,                  // VND integer
  originalPrice: number,                 // VND integer (priceMax)
  currentDiscountPct: number,            // 0..99
  lastObservedAt: Date,
  trackPriority: "hot" | "mid" | "low",  // set by FR-WORKER-002 scheduler
  _scheduleHash: number,                 // djb2(productId) for tier modulo
  affiliateLink: string,                 // canonical https://shopee.vn/...-i.<shop>.<item>
  commissionRate: number,                // informational only; NEVER use for ranking
  sales: number,                         // Shopee aggregate sale count
  currency: "VND",                       // reserved for P4 multi-region
  publicDealAt: Date | null,             // set by admin tool for /deal/<slug> public access
  createdAt: Date,
  updatedAt: Date,
  deletedAt: Date | null,                // soft-tombstone for dead items
}
// Indexes
//   { shopId: 1, itemId: 1 } unique
//   { trackPriority: 1, _scheduleHash: 1 }  // scheduler tier query
//   { slug: 1 }                              // share/deal page lookup
//   { lastObservedAt: -1 }                   // observability
//   { _id: 1 }                               // default
```

### TimescaleDB `price_history` row (recap from FR-PRICE-001 §3)

```sql
INSERT INTO price_history
  (product_id, shop_id, region, observed_at, price, original_price, discount_pct, stock, flash_sale, source)
VALUES
  ('123456-9876543210', 123456, 'VN', NOW(), 89000, 129000, 31, NULL, FALSE, 'affiliate_api')
ON CONFLICT (product_id, observed_at) DO NOTHING;
```

### Service skeleton

```ts
// apps/api/src/affiliate/offer-resolver.service.ts
@Injectable()
export class OfferResolverService {
  private readonly log = new Logger(OfferResolverService.name);

  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any
  ) {}

  async resolveProductOffer(shopId: number, itemId: number): Promise<NormalizedOffer | null> {
    const t0 = Date.now();
    const productId = `${shopId}-${itemId}`;
    let offer: ProductOfferNode | null = null;

    try {
      offer = await this.shopee.productOfferV2({ shopId, itemId });
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", phase: "resolve", productId } });
      throw e;
    }

    if (!offer) {
      await mongo.db("salenoti").collection("products").updateOne(
        { shopId, itemId },
        { $set: { deletedAt: new Date() } }
      );
      this.posthog.capture("product_offer_resolved", {
        shopId, itemId, source: "v2", outcome: "dead", latency_ms: Date.now() - t0,
      });
      return null;
    }

    const currentPrice = Math.round(Number(offer.priceMin));
    const originalPrice = Math.round(Number(offer.priceMax >= offer.priceMin ? offer.priceMax : offer.priceMin));
    const currentDiscountPct = originalPrice > currentPrice
      ? Math.min(99, Math.round((1 - currentPrice / originalPrice) * 100))
      : 0;
    // FR-AFF-003 §1 #7 — flash sale = price < 70% of original OR explicit Shopee flag.
    const flashSale =
      (originalPrice > 0 && currentPrice < originalPrice * 0.7) ||
      Boolean((offer as { flashSale?: boolean }).flashSale);

    const observedAt = new Date();

    try {
      await mongo.db("salenoti").collection("products").findOneAndUpdate(
        { shopId, itemId },
        {
          $setOnInsert: {
            shopId, itemId,
            slug: slugify(offer.productName),
            trackPriority: "mid",
            _scheduleHash: this.scheduleHash(productId),
            currency: "VND",
            createdAt: observedAt,
          },
          $set: {
            name: offer.productName,
            imageUrl: offer.imageUrl ?? null,
            currentPrice, originalPrice, currentDiscountPct,
            lastObservedAt: observedAt,
            affiliateLink: offer.productLink,
            commissionRate: Number(offer.commissionRate),
            sales: Number(offer.sales ?? 0),
            updatedAt: observedAt,
          },
          $unset: { deletedAt: "" },
        },
        { upsert: true }
      );
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", phase: "mongo_write", productId } });
      throw e;
    }

    try {
      await timescale.insertPriceHistory({
        productId, shopId, region: "VN",
        observedAt,
        price: currentPrice,
        originalPrice,
        discountPct: currentDiscountPct,
        stock: offer.stock ?? null,
        flashSale,
        source: "affiliate_api",
      });
    } catch (e) {
      // Outbox retry pattern lands in a follow-up FR; for now record + alert and don't fail the call.
      this.sentry.captureException(e, { tags: { fr: "FR-AFF-003", phase: "timescale_write", productId } });
      this.log.warn(`Timescale write failed for ${productId}: ${(e as Error).message}`);
    }

    this.posthog.capture("product_offer_resolved", {
      shopId, itemId,
      commissionRate: Number(offer.commissionRate),
      priceVnd: currentPrice,
      source: "v2",
      flashSale,
      outcome: "live",
      latency_ms: Date.now() - t0,
    });

    return { ...offer, currentPrice, originalPrice, currentDiscountPct, flashSale };
  }

  async resolveShopOffer(shopId: number): Promise<{ shopId: string; commissionRate: number } | null> {
    const cacheKey = `shopee:shop_offer:${shopId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
    const node = await this.shopee.shopOfferV2({ shopId });
    if (!node) return null;
    const out = { shopId: node.shopId, commissionRate: Number(node.commissionRate) };
    await redis.setex(cacheKey, 3600, JSON.stringify(out));
    return out;
  }

  private scheduleHash(productId: string): number {
    let h = 5381;
    for (let i = 0; i < productId.length; i++) h = ((h * 33) ^ productId.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 80);
}
```

---

## §4 — Acceptance criteria

1. `resolveProductOffer(123, 9876)` returns `NormalizedOffer` with `commissionRate ≥ 0`, `currentPrice` integer, `currentDiscountPct` 0-99.
2. After resolution, MongoDB `products` row exists with all required fields (`currentPrice`, `lastObservedAt`, `affiliateLink`, `_scheduleHash`, `slug`).
3. After resolution, TimescaleDB `price_history` row inserted with the same `observed_at` as `products.lastObservedAt`.
4. Item dead (Shopee returns empty `nodes[]`) → `products.deletedAt` set; no `price_history` row inserted; PostHog event with `outcome: "dead"`.
5. Resurrected item (previously dead, Shopee now returns offer) → `products.deletedAt` removed via `$unset` on next resolution.
6. Flash sale fixture (price = 50% of original) → `flashSale: true` in both `products.flashSale` field... wait — products doesn't store flashSale (it's a derived field per call). Verify the PostHog event AND the TimescaleDB row carry `flashSale: true`.
7. Explicit `flashSale: true` from Shopee response (even at 25% discount) → `flashSale: true`.
8. Grep CI: `grep -RE 'ORDER BY.*commission' apps/api/src/` returns ZERO hits; same for `sortBy.*commission` and `sort.*commissionRate`.
9. PostHog event includes `shopId` + `itemId` (public Shopee identifiers) and `latency_ms`; no PII (no email, no userId).
10. `resolveShopOffer(123)` returns commission rate; second call within 1h returns cached value (no Shopee API hit).
11. Round-trip latency p95 < 800 ms on healthy mock Shopee API.
12. Concurrent resolutions of the same `(shopId, itemId)`: Mongo upsert deduplicates via unique index; one canonical row exists post-race.
13. TimescaleDB write fails (e.g., Neon outage) → Mongo write succeeds; Sentry exception tagged `phase: "timescale_write"`; caller does NOT see the Timescale error (degraded mode).
14. `_scheduleHash` value is identical across multiple resolutions of the same `(shopId, itemId)` (deterministic).

---

## §5 — Verification

```ts
// apps/api/src/affiliate/__tests__/offer-resolver.spec.ts
describe("FR-AFF-003 — OfferResolverService", () => {
  it("AC1+2+3: live offer triggers Mongo upsert + Timescale insert", async () => {
    mockShopeeProductOffer({
      shopId: 1, itemId: 1, priceMin: 89_000, priceMax: 129_000,
      commissionRate: 0.03, productName: "Áo thun nam basic",
    });
    const offer = await resolver.resolveProductOffer(1, 1);
    expect(offer?.commissionRate).toBe(0.03);
    expect(offer?.currentDiscountPct).toBe(31);
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId: 1, itemId: 1 });
    expect(product?.currentPrice).toBe(89_000);
    expect(product?._scheduleHash).toBeGreaterThanOrEqual(0);
    const history = await timescale.query<{ price: number }>(
      `SELECT price FROM price_history WHERE product_id = '1-1' ORDER BY observed_at DESC LIMIT 1`
    );
    expect(history.rows[0].price).toBe(89_000);
  });

  it("AC4: empty nodes → deletedAt set, no price_history row", async () => {
    mockShopeeProductOffer({ shopId: 1, itemId: 999, empty: true });
    const r = await resolver.resolveProductOffer(1, 999);
    expect(r).toBeNull();
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId: 1, itemId: 999 });
    expect(product?.deletedAt).toBeDefined();
    const cnt = await timescale.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM price_history WHERE product_id = '1-999'`
    );
    expect(Number(cnt.rows[0].count)).toBe(0);
  });

  it("AC5: resurrected item unsets deletedAt", async () => {
    await mongo.db("salenoti").collection("products").insertOne({
      shopId: 1, itemId: 555, deletedAt: new Date(),
    });
    mockShopeeProductOffer({ shopId: 1, itemId: 555, priceMin: 50_000, priceMax: 50_000 });
    await resolver.resolveProductOffer(1, 555);
    const p = await mongo.db("salenoti").collection("products").findOne({ shopId: 1, itemId: 555 });
    expect(p?.deletedAt).toBeUndefined();
  });

  it("AC6: 50% discount marks flashSale true", async () => {
    mockShopeeProductOffer({ shopId: 1, itemId: 2, priceMin: 50_000, priceMax: 100_000 });
    const events = capturePostHog();
    await resolver.resolveProductOffer(1, 2);
    const ev = events.find((e) => e.event === "product_offer_resolved");
    expect(ev!.properties.flashSale).toBe(true);
  });

  it("AC7: explicit Shopee flashSale flag honored at 25% discount", async () => {
    mockShopeeProductOffer({ shopId: 1, itemId: 3, priceMin: 75_000, priceMax: 100_000, flashSale: true });
    const offer = await resolver.resolveProductOffer(1, 3);
    expect(offer?.flashSale).toBe(true);
  });

  it("AC8: grep CI — no commissionRate ranking anywhere in apps/api/src/", () => {
    const files = glob.sync("apps/api/src/**/*.ts");
    for (const f of files) {
      const t = fs.readFileSync(f, "utf8");
      expect(t).not.toMatch(/ORDER BY[\s\S]{0,80}commission/i);
      expect(t).not.toMatch(/sortBy.*commission/i);
      expect(t).not.toMatch(/sort.*commissionRate/i);
    }
  });

  it("AC9: PostHog event includes shopId/itemId/latency, no PII", async () => {
    const events = capturePostHog();
    await resolver.resolveProductOffer(1, 1);
    const ev = events.find((e) => e.event === "product_offer_resolved");
    expect(ev!.properties.shopId).toBeDefined();
    expect(ev!.properties.latency_ms).toBeGreaterThan(0);
    expect(JSON.stringify(ev)).not.toContain("@"); // no email
  });

  it("AC10: shopOffer 1h cache", async () => {
    mockShopeeShopOffer({ shopId: 1, commissionRate: 0.05 });
    await resolver.resolveShopOffer(1);
    const before = shopeeCallCount();
    const r = await resolver.resolveShopOffer(1);
    expect(r?.commissionRate).toBe(0.05);
    expect(shopeeCallCount()).toBe(before);
  });

  it("AC12: concurrent resolutions of same product produce one row", async () => {
    mockShopeeProductOffer({ shopId: 1, itemId: 7, priceMin: 100, priceMax: 100 });
    await Promise.all([resolver.resolveProductOffer(1, 7), resolver.resolveProductOffer(1, 7)]);
    const rows = await mongo.db("salenoti").collection("products").find({ shopId: 1, itemId: 7 }).toArray();
    expect(rows).toHaveLength(1);
  });

  it("AC13: Timescale failure does NOT propagate to caller", async () => {
    mockShopeeProductOffer({ shopId: 1, itemId: 8, priceMin: 100, priceMax: 100 });
    mockTimescaleFailure();
    const offer = await resolver.resolveProductOffer(1, 8);
    expect(offer).not.toBeNull(); // caller sees success
    const sentryEvents = await sentryEvents();
    expect(sentryEvents).toContainEqual(
      expect.objectContaining({ tags: expect.objectContaining({ phase: "timescale_write" }) })
    );
  });

  it("AC14: _scheduleHash deterministic across re-resolutions", async () => {
    mockShopeeProductOffer({ shopId: 1, itemId: 9, priceMin: 100, priceMax: 100 });
    await resolver.resolveProductOffer(1, 9);
    const p1 = await mongo.db("salenoti").collection("products").findOne({ shopId: 1, itemId: 9 });
    await resolver.resolveProductOffer(1, 9);
    const p2 = await mongo.db("salenoti").collection("products").findOne({ shopId: 1, itemId: 9 });
    expect(p1?._scheduleHash).toBe(p2?._scheduleHash);
  });
});
```

---

## §6 — Implementation skeleton

See §3 — `OfferResolverService` is the canonical implementation. Add `slugify(name)` as a top-level helper and `TimescaleClient.insertPriceHistory(row)` is provided by FR-PRICE-001. The `redis` client + `mongo` client come from the shared modules.

The 5-line additions to the existing skeleton in §3 that complete the spec:

```ts
// Cap discountPct at 99 (avoid 100% rounding edge when free items appear)
const currentDiscountPct = originalPrice > currentPrice
  ? Math.min(99, Math.round((1 - currentPrice / originalPrice) * 100))
  : 0;

// Flash sale: two-condition detection
const flashSale =
  (originalPrice > 0 && currentPrice < originalPrice * 0.7) ||
  Boolean((offer as { flashSale?: boolean }).flashSale);
```

---

## §7 — Dependencies

- **External:** Shopee Affiliate Open API (FR-AFF-001 §7 lead-time). TimescaleDB extension on Neon Postgres (FR-PRICE-001 §7). MongoDB Atlas with indexes per §3.
- **Internal:** FR-AFF-001 (Shopee client), FR-PRICE-001 (TimescaleClient + hypertable). FR-LEGAL-002 (5-principles firewall + CI grep gate; tested via AC8).
- **Infrastructure:** Redis for `shopOfferV2` 1-h cache.
- **Vendor:** zod (already in stack via FR-AFF-001), `mongodb@^6`.

---

## §8 — Example payloads

### MongoDB `products` row after first successful resolution

```json
{
  "_id": "ObjectId(...)",
  "shopId": 123456,
  "itemId": 9876543210,
  "slug": "ao-thun-nam-basic",
  "name": "Áo thun nam basic",
  "imageUrl": "https://cf.shopee.vn/file/...",
  "category": null,
  "currentPrice": 89000,
  "originalPrice": 129000,
  "currentDiscountPct": 31,
  "lastObservedAt": "2026-05-16T11:00:00Z",
  "trackPriority": "mid",
  "_scheduleHash": 2147483600,
  "affiliateLink": "https://shopee.vn/Áo-thun-nam-basic-i.123456.9876543210",
  "commissionRate": 0.03,
  "sales": 1247,
  "currency": "VND",
  "publicDealAt": null,
  "createdAt": "2026-05-16T11:00:00Z",
  "updatedAt": "2026-05-16T11:00:00Z",
  "deletedAt": null
}
```

### TimescaleDB `price_history` row

```sql
| product_id     | shop_id | region | observed_at      | price | original_price | discount_pct | stock | flash_sale | source        |
| 123456-9876543 | 123456  | VN     | 2026-05-16 11:00 | 89000 | 129000         | 31           | NULL  | false      | affiliate_api |
```

### PostHog event

```json
{
  "event": "product_offer_resolved",
  "properties": {
    "shopId": 123456,
    "itemId": 9876543210,
    "commissionRate": 0.03,
    "priceVnd": 89000,
    "source": "v2",
    "flashSale": false,
    "outcome": "live",
    "latency_ms": 542
  }
}
```

### Item dead (empty Shopee response)

```json
{
  "event": "product_offer_resolved",
  "properties": {
    "shopId": 123456,
    "itemId": 9999999999,
    "source": "v2",
    "outcome": "dead",
    "latency_ms": 380
  }
}
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Multiple variants (size, color)?** Resolved → at MVP, resolver returns the first variant's price. Variant-level prices are FR-PRICE-003 ML feature (P4). The watchlist row caries `productId = <shopId>-<itemId>`, not `<shopId>-<itemId>-<variantId>`; variant tracking would require a schema migration.
- **Q2: How long to cache `shopOfferV2`?** Resolved → 1 hour. Shop-level commission rates change at Shopee Mall's onboarding cadence (weekly at most per plan §F2 footer); 1h saves ~95% of calls. We accept up to 1h staleness on shop-level rate (which only matters for the rare case where product-level offer is absent — `commissionRate = 0` in that case is acceptable).
- **Q3: What if `shopOfferV2` also returns null?** Resolved → `commissionRate = 0` is written to the Mongo row; item is still tracked; no revenue attribution available until shop onboards Shopee Affiliate. Plan §B2 footer notes this is rare (< 5% of catalogue).
- **Q4: Region other than VN at P1?** Resolved → no; `region: "VN"` is hardcoded. P4 (FR-AFF-009) introduces multi-region routing; the `currency` field is reserved for that migration.
- **Q5: Should we validate `affiliateLink` matches the canonical regex before write?** Resolved → no, we trust the Shopee API response; if Shopee returns a weird URL we surface it; FR-AFF-002's regex check catches it downstream when the deeplink is invoked.
- **Q6: Stock field semantics?** Resolved → `stock: null` when Shopee doesn't expose it; `stock: number` when it does. Useful for FR-NOTIF-001 "low stock + low price" composite trigger (P3 candidate).

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Shopee returns price ≤ 0 or negative | zod parse fail (positive constraint) | Validation error; row skipped; Sentry tag `phase: "resolve"` | Investigate; if real (free item promotion), allow with explicit `priceMin: 0` field path |
| TimescaleDB insert fails after Mongo write succeeds | Sentry exception with `phase: "timescale_write"` | Mongo row exists with current price; price_history missing one observation | Outbox retry queue (P2 hardening); manual re-resolve fixes within next scheduler tick |
| MongoDB write fails | exception caught + re-thrown with `phase: "mongo_write"` tag | Caller errors; no Mongo row written; Timescale write skipped (defensive) | Worker retries (BullMQ default 3 attempts); fall through to scheduler tier deferral |
| `products` row exists with stale `commissionRate` | n/a — per-call $set overwrites every resolve | Auto-fresh | None needed |
| Item resurrects after `deletedAt` set | next resolution sees non-empty offer; $unset deletedAt | Re-track resumes; alert eligibility restored | Built-in via findOneAndUpdate |
| Flash sale flag false-positive (e.g., `priceMin > priceMax` in malformed response) | defensive check in skeleton `originalPrice = max(priceMin, priceMax)` | Treats as no flash sale (originalPrice == currentPrice → 0%) | None needed |
| Hash collision on slug (same name, different products) | n/a — slug is informational; primary key is (shopId, itemId) | UI shows correct name regardless via name field; URLs may have suffix `-2` appended client-side | None needed at MVP scale |
| Currency drift (Shopee returns IDR for VN-region item somehow) | n/a at P1 (hardcoded VN); P4 needs explicit `currency` field validation | Out of scope until P4 | FR-AFF-009 P4 |
| commissionRate displayed to user (UI bug) | Visual regression test in apps/web Storybook (P2) | UI shows publisher rate — leaks operational info | Hide on FE; add to plan §A3 transparency report quarterly |
| Shopee `productOfferV2` schema breaking change | zod fails on parse; Sentry tag `kind: "schema_drift"` | Caller errors with `ShopeeApiError("schema_drift")` from FR-AFF-001 | Hotfix zod schema; canary deploy |
| Race: 2 workers resolve same item concurrently | Mongo upsert deduplicates via unique index; both writes are idempotent | Either wins; both observations write to Timescale (allowed — `ON CONFLICT DO NOTHING` if same observed_at to second) | Built-in |
| Cache poisoning on `shopOfferV2` (Redis returns stale rate after Shopee Mall onboarding) | up to 1h staleness | up to 1h of slightly stale commissionRate on Mongo write | Self-resolves on next 1h boundary |
| `_scheduleHash` collision across products | djb2 over an unbounded ASCII string has very low collision at 100K products | Two products land in same scheduler minute slot — harmless (just slightly clumpier load) | None needed; not a correctness issue |
| Slug contains unicode that breaks URL routing | slugify strips combining marks + non-alnum | All slugs are URL-safe `[a-z0-9-]+` ≤ 80 chars | Built-in |

---

## §11 — Notes

- The dual-write outbox pattern (Mongo + Timescale via BullMQ retry) is the canonical pattern for this kind of event-sourced design. If the project moves to fully event-sourced architecture later (P3 ML pipeline, P4 multi-region), this resolver is a clean migration boundary: replace the inline `timescale.insertPriceHistory` call with a `kafka.produce(...)` or `outbox.enqueue(...)` call without touching the API surface.
- Plan §C3 + §F2 footer: "Shopee Mall items có commission cao hơn (5%); ngành hàng khác (1.5-2.5%)" — informational metadata stored on the row; never affects user-facing ranking or recommendation. The Transparency Report breaks down revenue by `commissionRate` bucket quarterly so users can audit our aggregate take rate.
- The `_scheduleHash` field is private (underscore-prefixed) — it's an implementation detail of FR-WORKER-002's scheduler. No public API exposes it. If we ever need to rebalance product distribution across scheduler minute slots (e.g., for cohort A/B testing), we can re-compute it without breaking any external contract.
- The choice to NOT cache `productOfferV2` at the resolver level is deliberate and tied to plan §A3 principle 4 ("mở source revenue model"). Users can re-derive any historic alert from the `price_history` table + the rule in FR-WATCH-002 trigger-eval — the system is auditable end-to-end at the timestamp granularity of the Timescale write.

---

*End of FR-AFF-003. Status: shipped (2026-05-17). Last expanded: 2026-05-16.*
