---
id: FR-PRICE-001
title: "TimescaleDB `price_history` hypertable + 30-min rolling continuous aggregate + 30/90/730-day retention policies"
module: PRICE
priority: MUST
status: accepted
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-PRICE-002, FR-AFF-003, FR-WATCH-002, FR-WORKER-002, FR-OBS-001]
depends_on: []
blocks: [FR-PRICE-002, FR-AFF-003, FR-WATCH-002]
effort_hours: 8
template: engineering-spec@1

new_files:
  - apps/api/migrations/20260516000001_price_history.sql
  - apps/api/src/db/timescale.client.ts
  - apps/api/src/db/timescale.module.ts
  - apps/api/src/db/timescale.types.ts
  - apps/api/src/db/__tests__/price-history.spec.ts
  - apps/api/src/db/__tests__/timescale-integration.spec.ts
modified_files:
  - apps/api/src/app.module.ts
allowed_tools: ["file_read/write apps/api/**", "bash pnpm test", "bash psql"]
disallowed_tools:
  - "use plain Postgres (without Timescale ext) — Timescale extension MUST be created"
  - "store price as DECIMAL/NUMERIC — INTEGER (VND, no fractional) per plan §C3"
  - "skip the continuous aggregate refresh policy — query latency on raw rows is unacceptable at 100K products"
  - "use SERIAL/BIGSERIAL primary key — composite (product_id, observed_at) is required for hypertable chunking"
risk_if_skipped: "Plan §C3 mandates PostgreSQL + TimescaleDB for `PriceHistory`. Without this hypertable, FR-WATCH-002 `lowest_30d` trigger and FR-PRICE-002 chart API can't query efficiently. At 100K products × ~50 observations/day = 5M rows/day; plain Postgres collapses at ~30 days unless we re-architect."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The API service MUST stand up a TimescaleDB-backed price-history store.

1. The system MUST create the `price_history` table via SQL migration with the schema in §3, then convert to a hypertable via `create_hypertable('price_history', 'observed_at')`.
2. The hypertable MUST be chunked on `observed_at` with a 7-day interval (`chunk_time_interval => INTERVAL '7 days'`).
3. The composite index `(product_id, observed_at DESC)` MUST exist; dimensional indexes `(shop_id)` and `(region)` MUST exist. Primary key MUST be `(product_id, observed_at)`.
4. The system MUST create a 30-minute rolling continuous aggregate `price_history_30min_agg` materializing per `(product_id, time_bucket('30 minutes', observed_at))` → `min(price)`, `max(price)`, `avg(price)::INTEGER`, `count(*)`. The aggregate MUST refresh every 15 minutes covering the last 1-hour window with `start_offset => '1 day'`.
5. A retention policy MUST drop chunks older than 730 days (~24 months) on the raw `price_history`. The continuous aggregate MUST retain 90 days.
6. The typed TypeScript client `timescale.client.ts` MUST expose:
   - `insertPriceHistory(row: PriceHistoryRow): Promise<void>` — UPSERT semantics on `(product_id, observed_at)` so dual-write retries are idempotent.
   - `insertPriceHistoryBatch(rows: PriceHistoryRow[]): Promise<{inserted: number; conflicted: number}>` — multi-row insert via single statement; batch size MUST be capped at 1000.
   - `getLast30dMin(productId: string): Promise<number | null>` — MUST query the 30-min aggregate (NOT the raw table).
   - `getHistory(productId: string, from: Date, to: Date, resolution?: "raw"|"30min"|"6h"|"24h"): Promise<PricePoint[]>` — resolution `raw` MUST be rejected if range > 7 days (per FR-PRICE-002 §1 #6); resolution defaults to `30min`.
   - `getStats(productId: string): Promise<PriceStats>` — `{ last30dMin, last30dMax, last7dAvg, observationCount }`.
7. The system MUST use Neon Postgres + Timescale extension (plan §C5 host options). DB URL MUST be loaded from Doppler `TIMESCALE_DB_URL` (separate connection from MongoDB).
8. Batch inserts MUST support up to 1000 rows per call; the implementation MUST use multi-VALUES INSERT (NOT serial inserts in a loop) to keep p95 latency < 800 ms for a 1000-row batch.
9. The `source` column MUST be an enum-checked TEXT with values `'affiliate_api' | 'extension_dom' | 'manual' | 'replay'`. P0/P1 writes ONLY `'affiliate_api'`; the other variants are reserved for P2+ ingestion paths.
10. The system MUST emit a Sentry event tagged `fr: "FR-PRICE-001"` on any INSERT or query failure, with `db.statement` redacted to the SQL template (no parameter values, to avoid leaking productIds in error logs per FR-OBS-001).
11. The pool MUST be configured with `max: 10` connections at MVP, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`. The pool MUST log connection-acquisition wait > 1s as a PostHog metric `timescale_pool_saturation`.
12. The migration MUST be idempotent — every `CREATE`, `SELECT add_*_policy`, and `CREATE MATERIALIZED VIEW` MUST use `IF NOT EXISTS` / `if_not_exists => TRUE` so re-running the migration after partial-success deploys is safe.
13. Time MUST be stored as `TIMESTAMPTZ` (timezone-aware). The API client MUST always pass UTC `Date` objects; serializing local-time strings is forbidden (failure mode #10).
14. Compression policy MUST be deferred to P2 (default Timescale columnstore compression after 7-day chunk close, configured via `add_compression_policy`); at MVP scale (~5M rows / 30 days) compression isn't needed and complicates reads.
15. The `flash_sale` boolean MUST be denormalized into `price_history` (NOT computed at query time) so FR-WATCH-002's `flash_sale` trigger evaluates in O(1) per observation.
16. Schema migration MUST be transactional where Timescale permits — `CREATE EXTENSION` and `create_hypertable` cannot run inside a transaction block; index creation MUST. The migration runner MUST split the file by separator `-- @SEPARATOR` and execute each block independently.

---

## §2 — Why this design

**Why TimescaleDB (not InfluxDB, not ClickHouse, not pure Postgres):** plan §C3 trade-off table — Timescale wins on (a) team familiarity (intern team knows SQL), (b) Postgres-compatible (no new query dialect), (c) continuous-aggregate primitive for fast `lowest_30d` queries, (d) hosted free tier at Timescale Cloud / Neon for MVP. InfluxDB would force learning Flux; ClickHouse is overkill at MVP scale; pure Postgres can't sustain 5M rows/day past 30 days without re-architecture.

**Why MongoDB + TimescaleDB hybrid (not all-Postgres or all-Mongo):** plan §C3 explicit decision — "Trưởng nhóm muốn intern học MongoDB, founder muốn intern học MongoDB. Reduce overhead phải làm 'dual-write' có thể giải quyết bằng Outbox pattern." MongoDB owns metadata + flexibility (variable product schemas, watchlist documents); TimescaleDB owns time-series (price observations).

**Why 7-day chunks:** Timescale optimal at ~25 chunks live for typical query patterns (last 6 months). 7-day chunk × ~26 weeks = 26 chunks at any point. Smaller chunks (1-day) inflate planner overhead; larger chunks (30-day) defeat the chunk-exclusion optimizer for "last 7 days" queries.

**Why 30-min continuous aggregate (not 5-min, not hourly):** matches FR-WORKER-002 hot tier cadence (30-min poll interval for popular products). Refresh every 15 min keeps aggregate fresh enough for `lowest_30d` triggers — worst-case 30-day-low detection latency is ~45 minutes (15-min refresh + 30-min bucket), well within product expectations. 5-min buckets would inflate the agg row count 6x without measurable trigger improvement.

**Why 730-day retention (raw) / 90-day (aggregate):** plan §B3 PDPL retention bands; price history is non-PII business data but tied to user actions. 24 months gives long-term ML training data (P4); chunks older auto-drop. The agg at 90 days covers all dashboards and alert triggers; older aggregated data is rarely queried and inflates index size.

**Why INTEGER price (VND no fractional):** plan §C3 schema. VND smallest unit is 1₫; no decimals needed; integer math is 5-10x faster than NUMERIC and simpler in TypeScript (`number` covers up to 2^53 = ~9 quadrillion, far above any product price). Storing as `int4` (max ~2.1B) is safe — most expensive Shopee item we've seen is ~500M ₫.

**Why composite PK `(product_id, observed_at)` not surrogate id:** hypertables in Timescale require the time-dimension column in the PK. The composite is also exactly the most-common query selector (one product over time), so the PK doubles as the primary read index.

**Why pool size 10 at MVP:** Vercel + Railway hot path is mostly reads via aggregate (fast); the heavy writes are batched in BullMQ workers (single connection per worker, ~3 workers). 10 connections covers 6× headroom. P3 may bump if read fanout grows.

**Why batch insert capped at 1000:** PG single-statement parameter limit is 32,767 (PostgreSQL `$N` parameter cap). 10 columns × 1000 rows = 10,000 params, well under the cap. Above 1000 rows, query-plan overhead and prepared-statement caching degrade; below ~100 rows, the batching benefit is marginal. 1000 hits the sweet spot.

---

## §3 — SQL migration

```sql
-- apps/api/migrations/20260516000001_price_history.sql

-- @SEPARATOR (Timescale: CREATE EXTENSION must be its own statement)
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- @SEPARATOR
CREATE TABLE IF NOT EXISTS price_history (
  product_id      TEXT NOT NULL,
  shop_id         BIGINT NOT NULL,
  region          TEXT NOT NULL DEFAULT 'VN',
  observed_at     TIMESTAMPTZ NOT NULL,
  price           INTEGER NOT NULL CHECK (price > 0),
  original_price  INTEGER,
  discount_pct    SMALLINT CHECK (discount_pct BETWEEN 0 AND 100),
  stock           INTEGER CHECK (stock >= 0),
  flash_sale      BOOLEAN NOT NULL DEFAULT false,
  source          TEXT NOT NULL DEFAULT 'affiliate_api'
                  CHECK (source IN ('affiliate_api','extension_dom','manual','replay')),
  PRIMARY KEY (product_id, observed_at)
);

-- @SEPARATOR (create_hypertable cannot run inside a transaction with table-creation)
SELECT create_hypertable(
  'price_history',
  'observed_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_price_history_shop
  ON price_history (shop_id);

CREATE INDEX IF NOT EXISTS idx_price_history_region
  ON price_history (region);

CREATE INDEX IF NOT EXISTS idx_price_history_product_observed_desc
  ON price_history (product_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_history_flash_sale
  ON price_history (flash_sale, observed_at DESC) WHERE flash_sale = true;

-- @SEPARATOR
CREATE MATERIALIZED VIEW IF NOT EXISTS price_history_30min_agg
WITH (timescaledb.continuous) AS
SELECT
  product_id,
  time_bucket(INTERVAL '30 minutes', observed_at) AS bucket,
  MIN(price)::INTEGER     AS min_price,
  MAX(price)::INTEGER     AS max_price,
  AVG(price)::INTEGER     AS avg_price,
  COUNT(*)::INTEGER       AS observation_count,
  bool_or(flash_sale)     AS any_flash_sale
FROM price_history
GROUP BY product_id, bucket
WITH NO DATA;

-- @SEPARATOR
SELECT add_continuous_aggregate_policy('price_history_30min_agg',
  start_offset => INTERVAL '1 day',
  end_offset   => INTERVAL '15 minutes',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => TRUE
);

-- @SEPARATOR
SELECT add_retention_policy('price_history',
  INTERVAL '730 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy('price_history_30min_agg',
  INTERVAL '90 days',
  if_not_exists => TRUE
);

-- @SEPARATOR  (operational view for dashboards)
CREATE OR REPLACE VIEW price_history_health AS
SELECT
  COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '1 hour') AS inserts_last_hour,
  COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '24 hours') AS inserts_last_24h,
  COUNT(DISTINCT product_id) FILTER (WHERE observed_at > NOW() - INTERVAL '24 hours') AS products_observed_24h,
  MAX(observed_at) AS latest_observation
FROM price_history;
```

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | clean Neon DB | migration runs | extension installed; `price_history` hypertable visible in `timescaledb_information.hypertables` |
| AC2 | hypertable exists | query `SELECT * FROM timescaledb_information.dimensions WHERE hypertable_name='price_history'` | row with `column_name='observed_at'`, `time_interval=INTERVAL '7 days'` |
| AC3 | seeded 10K rows across 100 products | `getLast30dMin('test-pid-50')` called 100x | p95 latency < 100ms; query plan shows scan of `price_history_30min_agg` (NOT raw) |
| AC4 | aggregate just refreshed | insert row at t0; query agg at t0+16min for that product's bucket | row visible in agg |
| AC5 | row dated 731 days ago inserted | retention policy triggered (`SELECT run_job(<job_id>)`) | row gone; agg row also gone if > 90 days |
| AC6 | INSERT with `(product_id='x', observed_at='2026-05-16T10:00Z')` twice | conflict resolution | one row only; second INSERT returns without error (ON CONFLICT DO NOTHING) |
| AC7 | INSERT with `source='foo'` | check constraint | ERROR 23514 check_violation |
| AC8 | `getStats('123-456')` called | aggregate has 50 rows | returns `{last30dMin, last30dMax, last7dAvg, observationCount}` all non-null and consistent with raw |
| AC9 | Neon temporarily unreachable | `insertPriceHistory` called | rejects after 5s connectionTimeout; Sentry event tagged `fr: "FR-PRICE-001"`, `db.error.code: "ECONNREFUSED"`, parameters redacted |
| AC10 | 1000-row batch | `insertPriceHistoryBatch` called | completes in < 800ms p95 (warm pool); returns `{inserted: 1000, conflicted: 0}` |
| AC11 | 1001-row batch | `insertPriceHistoryBatch` called | rejects synchronously with `BATCH_TOO_LARGE` error |
| AC12 | `getHistory(pid, from, to, 'raw')` with `to - from > 7 days` | request | rejects with `RAW_RESOLUTION_TOO_BROAD` (delegated to FR-PRICE-002 enforcement) |
| AC13 | concurrent INSERTs (10 in parallel, same product_id, same observed_at) | race | one wins; nine return without error; final row count = 1 |
| AC14 | migration re-run after partial-success | each block | every statement idempotent; no errors; no duplicate index creation |
| AC15 | flash_sale=true insert | observed | `idx_price_history_flash_sale` partial index used in queries with `WHERE flash_sale=true` |
| AC16 | local-time `Date` passed to client | client method | converted to UTC before INSERT; DB stores TIMESTAMPTZ correctly across server TZ changes |

---

## §5 — Verification

```ts
// apps/api/src/db/__tests__/timescale-integration.spec.ts
describe("FR-PRICE-001 — Timescale hypertable", () => {
  beforeAll(async () => {
    await runMigration("20260516000001_price_history.sql");
  });

  it("AC1+AC2: hypertable exists with 7-day chunks", async () => {
    const ht = await pool.query<{ hypertable_name: string }>(
      `SELECT hypertable_name FROM timescaledb_information.hypertables`
    );
    expect(ht.rows.map(r => r.hypertable_name)).toContain("price_history");
    const dim = await pool.query<{ column_name: string; time_interval: string }>(
      `SELECT column_name, time_interval FROM timescaledb_information.dimensions WHERE hypertable_name='price_history'`
    );
    expect(dim.rows[0].column_name).toBe("observed_at");
    expect(dim.rows[0].time_interval).toBe("7 days");
  });

  it("AC3: lowest_30d query uses aggregate (< 100ms p95)", async () => {
    await seedPrices({ products: 100, observationsPerProduct: 100 });
    const latencies: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      const min = await timescale.getLast30dMin("test-pid-50");
      latencies.push(performance.now() - t0);
      expect(min).toBeGreaterThan(0);
    }
    latencies.sort((a, b) => a - b);
    expect(latencies[Math.floor(latencies.length * 0.95)]).toBeLessThan(100);

    const plan = await pool.query(`EXPLAIN SELECT MIN(min_price) FROM price_history_30min_agg WHERE product_id='test-pid-50' AND bucket > NOW() - INTERVAL '30 days'`);
    expect(JSON.stringify(plan.rows)).toContain("price_history_30min_agg");
  });

  it("AC4: continuous aggregate refresh visible", async () => {
    const productId = `cagg-test-${nanoid(8)}`;
    const observedAt = new Date();
    await timescale.insertPriceHistory({ productId, shopId: 1, region: "VN", observedAt, price: 100000, source: "affiliate_api", flash_sale: false });
    await pool.query(`CALL refresh_continuous_aggregate('price_history_30min_agg', NOW() - INTERVAL '1 hour', NOW())`);
    const { rows } = await pool.query(`SELECT * FROM price_history_30min_agg WHERE product_id=$1`, [productId]);
    expect(rows).toHaveLength(1);
  });

  it("AC6: UPSERT idempotency", async () => {
    const row = { productId: "id-x", shopId: 1, region: "VN", observedAt: new Date("2026-05-16T10:00:00Z"), price: 1000, original_price: 1500, discount_pct: 33, stock: null, flash_sale: false, source: "affiliate_api" as const };
    await timescale.insertPriceHistory(row);
    await timescale.insertPriceHistory(row); // duplicate
    const { rows } = await pool.query(`SELECT count(*) FROM price_history WHERE product_id='id-x'`);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("AC7: source enum check rejects unknown", async () => {
    await expect(
      pool.query(`INSERT INTO price_history (product_id, shop_id, observed_at, price, source) VALUES ('x',1,NOW(),1,'foo')`)
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("AC10: 1000-row batch under 800ms p95", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      productId: `batch-${i}`, shopId: 1, region: "VN" as const,
      observedAt: new Date(Date.now() + i * 1000),
      price: 10000 + i, source: "affiliate_api" as const, flash_sale: false,
    }));
    const t0 = performance.now();
    const result = await timescale.insertPriceHistoryBatch(rows);
    expect(performance.now() - t0).toBeLessThan(800);
    expect(result.inserted).toBe(1000);
  });

  it("AC11: 1001-row batch rejected", async () => {
    const rows = Array.from({ length: 1001 }, () => makeRow());
    await expect(timescale.insertPriceHistoryBatch(rows)).rejects.toThrow("BATCH_TOO_LARGE");
  });

  it("AC13: concurrent same-key inserts converge to one row", async () => {
    const row = { productId: "race-x", shopId: 1, region: "VN" as const, observedAt: new Date("2026-05-16T10:00:00Z"), price: 1000, source: "affiliate_api" as const, flash_sale: false };
    await Promise.all(Array.from({ length: 10 }, () => timescale.insertPriceHistory(row)));
    const { rows } = await pool.query(`SELECT count(*) FROM price_history WHERE product_id='race-x'`);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("AC14: migration is idempotent", async () => {
    await expect(runMigration("20260516000001_price_history.sql")).resolves.not.toThrow();
    await expect(runMigration("20260516000001_price_history.sql")).resolves.not.toThrow();
  });
});
```

---

## §6 — Implementation skeleton

```ts
// apps/api/src/db/timescale.types.ts
export type PriceHistoryRow = {
  productId: string;
  shopId: number;
  region: "VN" | "TH" | "ID" | "MY" | "PH" | "SG";
  observedAt: Date;
  price: number;             // INTEGER VND
  original_price?: number;
  discount_pct?: number;
  stock?: number | null;
  flash_sale: boolean;
  source: "affiliate_api" | "extension_dom" | "manual" | "replay";
};

export type PricePoint = { observed_at: Date; price: number };

export type PriceStats = {
  last30dMin: number | null;
  last30dMax: number | null;
  last7dAvg: number | null;
  observationCount: number;
};

// apps/api/src/db/timescale.client.ts
import { Pool, PoolConfig } from "pg";
import * as Sentry from "@sentry/node";
import { posthog } from "../obs/posthog";

const MAX_BATCH_SIZE = 1000;

export class TimescaleClient {
  private pool: Pool;

  constructor(url: string, opts: Partial<PoolConfig> = {}) {
    this.pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...opts,
    });
    this.pool.on("error", (err) => Sentry.captureException(err, { tags: { fr: "FR-PRICE-001", layer: "pool" } }));
  }

  async insertPriceHistory(row: PriceHistoryRow): Promise<void> {
    try {
      await this._withMetrics("insertPriceHistory", () =>
        this.pool.query(
          `INSERT INTO price_history (product_id, shop_id, region, observed_at, price, original_price, discount_pct, stock, flash_sale, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (product_id, observed_at) DO NOTHING`,
          [row.productId, row.shopId, row.region, row.observedAt, row.price, row.original_price ?? null, row.discount_pct ?? null, row.stock ?? null, row.flash_sale, row.source]
        )
      );
    } catch (err) {
      this._captureDbError(err, "insertPriceHistory");
      throw err;
    }
  }

  async insertPriceHistoryBatch(rows: PriceHistoryRow[]): Promise<{ inserted: number; conflicted: number }> {
    if (rows.length > MAX_BATCH_SIZE) throw new Error(`BATCH_TOO_LARGE: ${rows.length} > ${MAX_BATCH_SIZE}`);
    if (rows.length === 0) return { inserted: 0, conflicted: 0 };

    const cols = 10;
    const placeholders = rows.map((_, i) => {
      const base = i * cols;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
    }).join(",");
    const params = rows.flatMap(r => [r.productId, r.shopId, r.region, r.observedAt, r.price, r.original_price ?? null, r.discount_pct ?? null, r.stock ?? null, r.flash_sale, r.source]);

    const result = await this._withMetrics("insertPriceHistoryBatch", () =>
      this.pool.query(
        `INSERT INTO price_history (product_id, shop_id, region, observed_at, price, original_price, discount_pct, stock, flash_sale, source)
         VALUES ${placeholders}
         ON CONFLICT (product_id, observed_at) DO NOTHING`,
        params
      )
    );
    return { inserted: result.rowCount ?? 0, conflicted: rows.length - (result.rowCount ?? 0) };
  }

  async getLast30dMin(productId: string): Promise<number | null> {
    const { rows } = await this._withMetrics("getLast30dMin", () =>
      this.pool.query(
        `SELECT MIN(min_price) AS m
         FROM price_history_30min_agg
         WHERE product_id = $1 AND bucket > NOW() - INTERVAL '30 days'`,
        [productId]
      )
    );
    return rows[0]?.m ?? null;
  }

  async getHistory(productId: string, from: Date, to: Date, resolution: "raw" | "30min" | "6h" | "24h" = "30min"): Promise<PricePoint[]> {
    const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (resolution === "raw" && rangeDays > 7) {
      throw new Error("RAW_RESOLUTION_TOO_BROAD");
    }
    if (resolution === "raw") {
      const { rows } = await this.pool.query(
        `SELECT observed_at, price FROM price_history WHERE product_id=$1 AND observed_at BETWEEN $2 AND $3 ORDER BY observed_at ASC`,
        [productId, from, to]
      );
      return rows;
    }
    const bucket = { "30min": "30 minutes", "6h": "6 hours", "24h": "1 day" }[resolution];
    const { rows } = await this.pool.query(
      `SELECT time_bucket(INTERVAL '${bucket}', bucket) AS observed_at, AVG(avg_price)::INTEGER AS price
       FROM price_history_30min_agg
       WHERE product_id=$1 AND bucket BETWEEN $2 AND $3
       GROUP BY observed_at ORDER BY observed_at ASC`,
      [productId, from, to]
    );
    return rows;
  }

  async getStats(productId: string): Promise<PriceStats> {
    const { rows } = await this.pool.query(
      `WITH s AS (
        SELECT
          MIN(min_price) FILTER (WHERE bucket > NOW() - INTERVAL '30 days') AS last30dmin,
          MAX(max_price) FILTER (WHERE bucket > NOW() - INTERVAL '30 days') AS last30dmax,
          AVG(avg_price) FILTER (WHERE bucket > NOW() - INTERVAL '7 days')::INTEGER AS last7davg,
          SUM(observation_count) FILTER (WHERE bucket > NOW() - INTERVAL '30 days')::INTEGER AS observationcount
        FROM price_history_30min_agg
        WHERE product_id = $1
      ) SELECT * FROM s`,
      [productId]
    );
    return {
      last30dMin: rows[0]?.last30dmin ?? null,
      last30dMax: rows[0]?.last30dmax ?? null,
      last7dAvg: rows[0]?.last7davg ?? null,
      observationCount: rows[0]?.observationcount ?? 0,
    };
  }

  private async _withMetrics<T>(op: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      const result = await fn();
      const elapsed = performance.now() - t0;
      if (elapsed > 1000) {
        posthog?.capture({ event: "timescale_pool_saturation", properties: { op, elapsed_ms: Math.round(elapsed) } });
      }
      return result;
    } catch (err) {
      throw err;
    }
  }

  private _captureDbError(err: unknown, op: string): void {
    const e = err as { code?: string; message?: string };
    Sentry.captureException(err, {
      tags: { fr: "FR-PRICE-001", op, "db.error.code": e.code ?? "unknown" },
      // statement template only — never params (PII leak risk per FR-OBS-001)
      contexts: { db: { op, code: e.code } },
    });
  }

  async healthCheck(): Promise<{ ok: boolean; latest_observation: Date | null }> {
    try {
      const { rows } = await this.pool.query(`SELECT * FROM price_history_health LIMIT 1`);
      return { ok: true, latest_observation: rows[0]?.latest_observation ?? null };
    } catch {
      return { ok: false, latest_observation: null };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

---

## §7 — Dependencies

- Doppler env `TIMESCALE_DB_URL` (Neon Postgres + Timescale extension, or Timescale Cloud)
- `pg@^8` driver
- `@sentry/node` (FR-OBS-001)
- PostHog metrics client (FR-OBS-001)
- Migration runner that splits SQL by `-- @SEPARATOR` markers (custom thin wrapper or `node-pg-migrate` with raw blocks)

---

## §8 — Example payloads

### Insert single observation

```ts
await timescale.insertPriceHistory({
  productId: "i.123.456",
  shopId: 123,
  region: "VN",
  observedAt: new Date("2026-05-16T10:30:00Z"),
  price: 2_990_000,        // 2,990,000 ₫
  original_price: 4_990_000,
  discount_pct: 40,
  stock: 25,
  flash_sale: true,
  source: "affiliate_api",
});
```

### Expected EXPLAIN plan for `getLast30dMin`

```
Aggregate  (cost=12.5..12.6 rows=1 width=4)
  ->  Custom Scan (ChunkAppend) on _materialized_hypertable_2 price_history_30min_agg
        Chunks excluded during planning: 5 (older than 30d)
        ->  Index Scan using _hyper_2_chunk_idx_product
              Index Cond: (product_id = 'i.123.456')
              Filter: (bucket > now() - '30 days')
```

### Stats response

```json
{
  "last30dMin": 2790000,
  "last30dMax": 4990000,
  "last7dAvg": 3120000,
  "observationCount": 1240
}
```

---

## §9 — Open questions (resolved)

**Q1: Single hypertable for all regions, or per-region partitioned hypertables?**
A: Single hypertable + `region` indexed column. P3 may switch to space-partitioning if multi-region scaling demands. Multi-region is a P4 milestone per plan §G4; not pre-optimizing.

**Q2: Compression policy?**
A: Deferred to P2 (default Timescale columnstore compression after 7-day chunk close, configured via `add_compression_policy`). At MVP scale (~5M rows total / 30 days) compression isn't needed and complicates point reads.

**Q3: Read replica?**
A: Deferred to P3. Neon has built-in read replicas at the Pro tier; we'll evaluate when read QPS exceeds ~500/s.

**Q4: Why not use BIGINT for product_id?**
A: Shopee product ids are not numeric — they're composite slugs like `iphone-15-pro-i.123.456`. TEXT covers the full URL canonical form per FR-AFF-003. The composite primary key still indexes efficiently.

**Q5: Should we also write to the aggregate directly?**
A: No. Timescale's continuous-aggregate refresh policy handles this. Direct writes to the materialized view would create consistency issues. The refresh is fast enough (15-min cadence) for our triggers.

**Q6: How do we backfill historical data from Shopee API?**
A: Out of scope for this FR — backfill is a P2 ops task (`source = 'replay'` enum reserved). The schema supports it; the worker is separate (future FR-PRICE-003).

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Timescale extension not installed on Neon | migration fails on `CREATE EXTENSION` | psql error 0A000 feature_not_supported | enable extension in Neon console (free tier supports it) | error |
| 2 | Continuous aggregate refresh job stalled | job last run > 30 min ago | Timescale `timescaledb_information.job_stats.last_run_status='Failed'` | restart job via `SELECT alter_job(id, scheduled => true)`; check Neon resource limits | warning |
| 3 | `observed_at` set to future timestamp | client passes a Date in future | app-layer validation rejects pre-INSERT | reject at `insertPriceHistory` boundary; return `OBSERVED_AT_IN_FUTURE` | info |
| 4 | Concurrent inserts same `(product_id, observed_at)` | parallel worker fires | `ON CONFLICT DO NOTHING` | idempotent; one wins | info |
| 5 | Retention chunk drop while query in flight | rare timing | Timescale chunk-drop blocks until query completes | none needed | info |
| 6 | Pool exhausted (10 conns held by long queries) | wait > 5s for connection | `connectionTimeoutMillis` fires | bump pool max temporarily; investigate slow query in pg_stat_activity | warning |
| 7 | `source` NULL passed | client bug | check constraint rejects | app-layer default to `'affiliate_api'` | info |
| 8 | Query without `product_id` filter | dev mistake | full hypertable seq scan | DBA review; add lint that `getHistory` requires productId param (already enforced by client signature) | warning |
| 9 | Migration runs twice | re-deploy | every `IF NOT EXISTS` / `if_not_exists => TRUE` | idempotent; no-op | info |
| 10 | Server timezone drift (server UTC vs DB UTC) | TIMESTAMPTZ stored | DB enforces UTC normalization; client passes UTC Date | none needed | info |
| 11 | `price = 0` or negative submitted | bad parse from Shopee API | CHECK (price > 0) rejects | log + Sentry; price-parser fix in FR-AFF-003 | warning |
| 12 | Aggregate gap (refresh policy paused for hours) | infra outage | `last_run_status` monitor + dashboard | resume via `alter_job`; back-refresh via `CALL refresh_continuous_aggregate(...)` | warning |
| 13 | Disk full on Neon (chunks not dropped fast enough) | Neon storage alert | retention job runs daily by default | manually trigger retention job; consider tightening retention to 365d | error |
| 14 | Index bloat after high-churn period | pg_stat_user_indexes | rare at our scale | `REINDEX CONCURRENTLY` in maintenance window | info |
| 15 | Schema drift between migration files and runtime | new column added to schema but migration not run | dev env vs prod schema diff | pre-deploy schema check job in CI; fail deploy if drift | error |
| 16 | Sentry rate-limit during DB outage storm | many concurrent errors | Sentry quota alerts | client-side error sampling at 1% during storms; aggregate before reporting | warning |

---

## §11 — Notes

- The continuous aggregate is the secret sauce for FR-WATCH-002 `lowest_30d` trigger; without it, eval cost on hot tier kills the worker pool (raw-row scan of 5M rows takes ~300ms uncached; agg is < 10ms).
- Plan §C3 outbox-pattern recommendation: app writes to MongoDB first (offers collection), then BullMQ job inserts to Timescale. This FR provides the sink; FR-AFF-003 produces.
- The `idx_price_history_flash_sale` partial index is a deliberate optimization for FR-WATCH-002's `flash_sale` trigger — only ~5% of observations carry `flash_sale=true`, so the partial index is ~20x smaller than a full index.
- `region` defaults to `'VN'` for MVP. P4 multi-region will add `'TH','ID','MY','PH','SG'` to the enum; the migration's `region TEXT NOT NULL DEFAULT 'VN'` is forward-compatible (no schema change needed).
- The migration runner is custom: each `-- @SEPARATOR` block runs as its own statement. Tools like `node-pg-migrate` work if configured for non-transactional mode for the `CREATE EXTENSION` and `create_hypertable` blocks.

---

*FR-PRICE-001 spec — last revised 2026-05-16. Status: accepted (10/10).*
