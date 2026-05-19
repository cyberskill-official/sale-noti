---
id: FR-AFF-008
title: "Add platform field to Product and PriceHistory collections"
module: AFF
priority: MUST
status: accepted
verify: T
phase: P3
milestone: "P3 - slice 3 - Schema pivot"
slice: 3
owner: "Senior Tech Lead"
created: 2026-05-19
related_frs:
  - FR-AFF-003
  - FR-AFF-005
  - FR-AFF-006
  - FR-AFF-007
  - FR-PRICE-001
  - FR-WATCH-001
depends_on:
  - FR-AFF-003
  - FR-PRICE-001
blocks:
  - FR-WATCH-004
  - FR-NOTIF-004
  - FR-ADMIN-002
  - FR-ADMIN-003
  - FR-ADMIN-004
  - FR-OBS-002
  - FR-AFF-009
effort_hours: 8
template: engineering-spec@1
new_files:
  - apps/api/migrations/20260519000002_platform_pivot.sql
  - apps/api/scripts/backfill-platform.mjs
  - apps/api/src/db/platform.ts
  - apps/api/src/db/__tests__/platform.spec.ts
modified_files:
  - apps/api/src/db/timescale.client.ts
  - apps/api/src/affiliate/offer-resolver.service.ts
  - apps/api/src/affiliate/deeplink.service.ts
  - apps/api/src/price/history.service.ts
  - apps/api/src/affiliate/__tests__/offer-resolver.spec.ts
  - apps/api/src/db/__tests__/timescale.client.spec.ts
risk_if_skipped: "If the schema stays Shopee-shaped, Lazada/TikTok/mobile/B2B rows will keep overloading the same product identity and require a second migration before multi-platform features can ship safely."
---

## §1 - Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The API service MUST treat `platform` as the marketplace discriminator for product and price-history storage. In this FR, `platform` means marketplace platform, not affiliate network: AccessTrade remains a fallback network, not a platform.

1. The storage layer MUST support the closed marketplace set `shopee`, `lazada`, and `tiktok_shop`. Any unknown value MUST fail closed at the helper boundary.
2. All current Shopee write paths MUST persist `platform: "shopee"` by default. All current Shopee read paths MUST continue to behave exactly as they do today when no platform is supplied.
3. `TimescaleClient.insertPriceHistory()`, `insertPriceHistoryBatch()`, `getLast30dMin()`, `getHistory()`, `getBucketedHistory()`, and `getStats()` MUST persist or consume `platform` and the uniqueness rule MUST become `(platform, product_id, observed_at)` so two platforms can never collide on the same price-history row.
4. The `price_history_30min_agg` continuous aggregate MUST group by `platform` and `product_id`. Aggregate reads and `HistoryService.getBucketedHistory()` MUST filter by platform when a caller provides one and MUST default to `shopee` for legacy Shopee-only callers.
5. Mongo `products` documents MUST include `platform`, and the canonical upsert key MUST include `{ platform, shopId, itemId }` as well as the existing product identity so future Lazada/TikTok rows cannot overwrite Shopee data.
6. A shared helper in `apps/api/src/db/platform.ts` MUST normalize platform inputs, provide a single default value for legacy callers, and expose the Mongo product-filter helper used by the DB writer paths, read paths, and backfill script.
7. The Mongo backfill script MUST update legacy `products` documents missing `platform` to `shopee`, MUST create the unique compound index on `{ platform: 1, shopId: 1, itemId: 1 }` idempotently, and it MUST be safe to rerun.
8. Public Shopee routes, caches, and response shapes MUST remain unchanged. This FR only adds storage identity and internal helper surfaces; it does not introduce new public platform-aware endpoints.

## §2 - Why this design

SaleNoti is already moving from a single-marketplace shape toward Lazada, TikTok Shop, and later regional expansion. The current data model is still Shopee-shaped: the product identity is effectively `shopId-itemId`, and `price_history` groups only by `product_id`. That works today, but it does not leave room for a second marketplace to write concurrently without a second migration or a collision-prone ad hoc prefix scheme.

The platform field is the smallest stable pivot. It keeps the existing `productId` convention intact for Shopee callers, but it gives the storage layer a marketplace discriminator that can survive Lazada, TikTok Shop, and future regional variants. That is a schema change, not a product rewrite.

`platform` must not be confused with affiliate network choice. AccessTrade is a fallback network and a transport decision; `platform` is the marketplace from which the product came. Keeping those separate avoids conflating resilience logic with catalog identity.

The Mongo backfill script exists because Mongo does not have the SQL migration runner that Timescale has. The safe path is to backfill legacy `products` documents to `shopee`, then let the new writers continue to emit `platform` explicitly.

## §3 - API contract and code shape

### Files

- `apps/api/src/db/platform.ts`
- `apps/api/migrations/20260519000002_platform_pivot.sql`
- `apps/api/scripts/backfill-platform.mjs`
- `apps/api/src/db/timescale.client.ts`
- `apps/api/src/affiliate/offer-resolver.service.ts`
- `apps/api/src/db/__tests__/platform.spec.ts`
- `apps/api/src/db/__tests__/timescale.client.spec.ts`
- `apps/api/src/affiliate/__tests__/offer-resolver.spec.ts`

### Environment

- `TIMESCALE_DB_URL`
- `MONGODB_URI`

### Core types

```ts
export type Platform = "shopee" | "lazada" | "tiktok_shop";

export const DEFAULT_PLATFORM: Platform = "shopee";

export function normalizePlatform(value?: string | null): Platform;

export function isPlatform(value: unknown): value is Platform;

export function productFilterFromIdentity(input: {
  platform?: Platform;
  shopId: number;
  itemId: number;
}): Record<string, unknown>;
```

```ts
export type PriceHistoryRow = {
  platform: Platform;
  productId: string;
  shopId: number;
  region: string;
  observedAt: Date;
  price: number;
  originalPrice?: number | null;
  discountPct?: number | null;
  stock?: number | null;
  flashSale: boolean;
  source: "affiliate_api" | "extension_dom" | "manual" | "replay";
};
```

### Service shape

```ts
class TimescaleClient {
  async insertPriceHistory(row: PriceHistoryRow): Promise<void>;
  async insertPriceHistoryBatch(rows: PriceHistoryRow[]): Promise<{ inserted: number; conflicted: number }>;
  async getLast30dMin(productId: string, platform: Platform = DEFAULT_PLATFORM): Promise<number | null>;
  async getHistory(productId: string, from: Date, to: Date, resolution?: HistoryResolution, platform?: Platform): Promise<PricePoint[]>;
  async getBucketedHistory(args: {
    productId: string;
    from: Date;
    bucketInterval: "30 minutes" | "1 hour" | "6 hours" | "1 day";
    platform?: Platform;
  }): Promise<Array<{ t: Date; p: number; p_min: number; p_max: number }>>;
  async getStats(productId: string, platform: Platform = DEFAULT_PLATFORM): Promise<PriceStats>;
}

class OfferResolverService {
  async resolveProductOffer(shopId: number, itemId: number): Promise<NormalizedOffer | null>;
}

class HistoryService {
  async getHistory(args: {
    userId: string | null;
    adminToken?: string | null;
    productId: string;
    range: "7d" | "30d" | "90d";
    granularity: "raw" | "30m" | "1h" | "6h" | "1d";
    source: "web" | "ext" | "deal-page";
    platform?: Platform;
  }): Promise<{ productId: string; range: string; granularity: string; points: Array<{ t: Date; p: number; p_min: number; p_max: number }> }>;
}
```

The public Shopee-facing routes MAY keep their current signatures. The platform discriminator is an internal storage concern for this FR, but the read helpers MUST still be platform-aware so later marketplace slices can query the same storage safely.

## §4 - Acceptance criteria

1. Given a normal Shopee resolve, `OfferResolverService` writes `platform: "shopee"` into the Mongo `products` document and `TimescaleClient.insertPriceHistory()` writes `platform: "shopee"` into `price_history`.
2. Given the new Timescale migration, `price_history` contains a `platform` column, the uniqueness rule includes `platform`, and the 30-minute aggregate groups by `platform` plus `product_id`.
3. Given the new `platform.ts` helper, only `shopee`, `lazada`, and `tiktok_shop` are accepted; any other value fails closed.
4. Given current Shopee-only callers, `TimescaleClient` query methods and `HistoryService.getBucketedHistory()` keep the existing public behavior when platform is omitted and default to `shopee` internally.
5. Given a Lazada or TikTok row with the same `productId` as a Shopee row, the two rows do not collide because `platform` is part of the storage identity and Mongo `products` uses a platform-aware filter key.
6. Given the Mongo backfill script, legacy `products` documents missing `platform` are updated to `shopee`, the compound index on `{ platform, shopId, itemId }` is created idempotently, and the script does not change `shopId`, `itemId`, `productId`, or timestamps.
7. Given an interrupted backfill, rerunning the script is safe and does not duplicate or corrupt rows.

## §5 - Verification

```ts
// apps/api/src/db/__tests__/platform.spec.ts
it("normalizes platform values and defaults to Shopee", () => {
  expect(normalizePlatform(undefined)).toBe("shopee");
  expect(normalizePlatform("lazada")).toBe("lazada");
  expect(normalizePlatform("tiktok_shop")).toBe("tiktok_shop");
  expect(() => normalizePlatform("accesstrade")).toThrow("unsupported_platform");
});

it("builds a platform-aware Mongo product filter and defaults to Shopee", () => {
  expect(productFilterFromIdentity({ shopId: 123, itemId: 456 })).toEqual({ platform: "shopee", shopId: 123, itemId: 456 });
  expect(productFilterFromIdentity({ platform: "lazada", shopId: 123, itemId: 456 })).toEqual({ platform: "lazada", shopId: 123, itemId: 456 });
});
```

```ts
// apps/api/src/db/__tests__/timescale.client.spec.ts
it("persists platform-aware price-history rows", async () => {
  await client.insertPriceHistory({
    platform: "shopee",
    productId: "123456-9876543210",
    shopId: 123456,
    region: "VN",
    observedAt: new Date("2026-05-19T10:00:00Z"),
    price: 100000,
    flashSale: false,
    source: "affiliate_api",
  });

  expect(pgClient.query).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO price_history"),
    expect.arrayContaining(["shopee", "123456-9876543210", 123456]),
  );
});

it("passes platform through aggregate reads when provided", async () => {
  await client.getBucketedHistory({
    platform: "lazada",
    productId: "123456-9876543210",
    from: new Date("2026-05-18T00:00:00Z"),
    bucketInterval: "30 minutes",
  });

  expect(pgClient.query).toHaveBeenCalledWith(
    expect.stringContaining("FROM price_history_30min_agg"),
    expect.arrayContaining(["30 minutes", "123456-9876543210"]),
  );
});
```

```ts
// apps/api/src/affiliate/__tests__/offer-resolver.spec.ts
it("writes platform shopee into Mongo products and Timescale", async () => {
  await resolver.resolveProductOffer(123456, 9876543210);

  expect(state.productOps.findOneAndUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ shopId: 123456, itemId: 9876543210 }),
    expect.objectContaining({
      $setOnInsert: expect.objectContaining({ platform: "shopee" }),
      $set: expect.objectContaining({ platform: "shopee" }),
    }),
    { upsert: true },
  );

  expect(state.timescale.insertPriceHistory).toHaveBeenCalledWith(
    expect.objectContaining({ platform: "shopee", productId: "123456-9876543210" }),
  );
});

```ts
// apps/api/src/affiliate/__tests__/deeplink.spec.ts
it("uses the platform-aware Mongo product filter for deeplink reads", async () => {
  await service.generate({ userId: "user-1", productId: "123456-9876543210", source: "ext" });

  expect(productFilterFromIdentity).toHaveBeenCalledWith({ platform: "shopee", shopId: 123456, itemId: 9876543210 });
});
```
```

```ts
// apps/api/scripts/backfill-platform.mjs
it("backfills missing product platform fields idempotently", async () => {
  await runBackfill();
  await runBackfill();

  expect(collection.updateMany).toHaveBeenCalledWith(
    { platform: { $exists: false } },
    { $set: { platform: "shopee" } },
  );
  expect(collection.createIndex).toHaveBeenCalledWith(
    { platform: 1, shopId: 1, itemId: 1 },
    { unique: true, name: "products_platform_shop_item_unique" },
  );
});
```

## §6 - Implementation skeleton

```ts
// apps/api/src/db/platform.ts
export type Platform = "shopee" | "lazada" | "tiktok_shop";

export const DEFAULT_PLATFORM: Platform = "shopee";

export function isPlatform(value: unknown): value is Platform {
  return value === "shopee" || value === "lazada" || value === "tiktok_shop";
}

export function normalizePlatform(value?: string | null): Platform {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_PLATFORM;
  if (isPlatform(normalized)) return normalized;
  throw new Error("unsupported_platform");
}

export function productFilterFromIdentity(input: { platform?: Platform; shopId: number; itemId: number }): Record<string, unknown> {
  return {
    platform: input.platform ?? DEFAULT_PLATFORM,
    shopId: input.shopId,
    itemId: input.itemId,
  };
}
```

```ts
// apps/api/src/db/timescale.client.ts
// platform is part of the uniqueness key and aggregate grouping.
const INSERT_PRICE_HISTORY_SQL = `INSERT INTO price_history
  (platform, product_id, shop_id, region, observed_at, price, original_price, discount_pct, stock, flash_sale, source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (platform, product_id, observed_at) DO NOTHING`;

// Query helpers default to Shopee when platform is omitted.
```

```ts
// apps/api/src/affiliate/offer-resolver.service.ts
await mongo.db("salenoti").collection("products").findOneAndUpdate(
  { platform: DEFAULT_PLATFORM, shopId, itemId },
  {
    $setOnInsert: { platform: DEFAULT_PLATFORM, shopId, itemId, ... },
    $set: { platform: DEFAULT_PLATFORM, ... },
  },
  { upsert: true },
);
await timescale.insertPriceHistory({ platform: DEFAULT_PLATFORM, productId, shopId, region: "VN", ... });

// apps/api/src/affiliate/deeplink.service.ts
const product = await mongo.db("salenoti").collection("products").findOne(
  productFilterFromIdentity({ platform: DEFAULT_PLATFORM, shopId, itemId }),
);

// apps/api/src/price/history.service.ts
const product = await mongo.db("salenoti").collection("products").findOne(productFilterFromIdentity({ platform: args.platform, shopId, itemId }));
const points = await timescale.getBucketedHistory({ productId: args.productId, from, bucketInterval: BUCKET_INTERVAL[args.granularity], platform: args.platform });
```

```ts
// apps/api/scripts/backfill-platform.mjs
const cursor = mongo.db("salenoti").collection("products").find({ platform: { $exists: false } });
for await (const doc of cursor) {
  await collection.updateOne({ _id: doc._id }, { $set: { platform: "shopee" } });
}
```

## §7 - Dependencies

External dependencies:

- TimescaleDB migration runner and PostgreSQL access.
- MongoDB write access for the platform backfill.

Internal dependencies:

- `FR-AFF-003` for the existing Shopee product/price write path.
- `FR-PRICE-001` for the Timescale schema and aggregates.
- `FR-AFF-005`, `FR-AFF-006`, and `FR-AFF-007` for the multi-platform P3 slices that will consume the pivot.

## §8 - Example payloads

### Mongo product document

```json
{
  "platform": "shopee",
  "shopId": 123456,
  "itemId": 9876543210,
  "productId": "123456-9876543210",
  "name": "Áo thun nam basic",
  "currentPrice": 100000,
  "originalPrice": 129000,
  "currency": "VND"
}
```

### Timescale price-history row

```json
{
  "platform": "shopee",
  "product_id": "123456-9876543210",
  "shop_id": 123456,
  "region": "VN",
  "observed_at": "2026-05-19T10:00:00.000Z",
  "price": 100000,
  "original_price": 129000,
  "discount_pct": 22,
  "stock": 25,
  "flash_sale": false,
  "source": "affiliate_api"
}
```

### Backfill result

```text
backfill-platform: updated 12483 product documents, skipped 0, platform defaulted to shopee
```

## §9 - Open questions

All resolved at authoring time:

1. `platform` is the marketplace discriminator, not the affiliate-network label.
2. Shopee remains the default so current public APIs and caches do not change.
3. Legacy Mongo and Timescale rows are backfilled explicitly or defaulted in the migration, and the Mongo product collection gets a compound unique index on `{ platform, shopId, itemId }`.
4. Future platform-aware public APIs are out of scope for this FR and belong to later platform slices.

## §10 - Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Legacy Mongo product missing `platform` | backfill script finds docs with `$exists: false` | doc remains ambiguous until backfill runs | rerun `backfill-platform.mjs` idempotently |
| New write omits `platform` | helper boundary / tests fail | write rejected or defaults incorrectly | fix caller to import `DEFAULT_PLATFORM` |
| Unsupported platform string | `normalizePlatform()` rejects it | `unsupported_platform` error | add only closed-enum marketplace values |
| Timescale migration not applied | insert hits missing column or wrong PK | price write fails or collides | apply `20260519000002_platform_pivot.sql` |
| Aggregate still groups only by product_id | tests show mixed-platform bleed | cross-platform stats become wrong | update continuous aggregate grouping by `platform, product_id` |
| Legacy Shopee read path changes shape | existing tests fail | compatibility regression | keep public Shopee signatures unchanged |
| Same productId on two platforms collides | unique constraint violation / overwrite | multi-platform write lost | keep `platform` in storage identity and unique keys |
| Mongo product upsert races on legacy rows | duplicate-key contention during cutover | one write can win and the other can lose updates | create unique index on `{ platform, shopId, itemId }` and rerun the backfill script |
| Backfill script interrupted mid-run | partial updates seen in Mongo | mixed platform completeness | rerun script; updates are idempotent |
| Telemetry omits platform | logs/events hard to interpret | ambiguous observability | include platform only when it is semantically relevant |

## §11 - Notes

- This is a structural bridge between the current Shopee-shaped baseline and the later Lazada/TikTok/mobile/B2B slices.
- The FR intentionally keeps the current `productId` strings intact for Shopee callers.
- The schema pivot is complete only when both the SQL migration and Mongo backfill exist; one without the other is not enough.

*End of FR-AFF-008 spec.*
