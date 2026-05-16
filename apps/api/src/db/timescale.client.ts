// FR-PRICE-001 §6 — TimescaleDB typed client.
// Wraps a single pg Pool. Methods match FR §1 #6 exactly.
import { Pool, type PoolClient } from "pg";

export type PriceHistoryRow = {
  productId: string;
  shopId: number;
  region: string;
  observedAt: Date;
  price: number;
  originalPrice: number | null;
  discountPct: number | null;
  stock: number | null;
  flashSale: boolean;
  source: "affiliate_api" | "extension_dom" | "manual" | "replay";
};

export type PricePoint = { observed_at: Date; price: number };

export type PriceStats = {
  last30dMin: number | null;
  last30dMax: number | null;
  last7dAvg: number | null;
  observationCount: number;
};

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  if (!process.env.TIMESCALE_DB_URL) {
    throw new Error("TIMESCALE_DB_URL not set — configure Doppler before calling Timescale.");
  }
  _pool = new Pool({
    connectionString: process.env.TIMESCALE_DB_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on("error", (err) => {
    // Surface to OBS but keep the process alive.
    console.error("[timescale] pool error", err);
  });
  return _pool;
}

export const timescale = {
  /** FR-PRICE-001 §1 #6 — UPSERT semantics via ON CONFLICT DO NOTHING. */
  async insertPriceHistory(row: PriceHistoryRow): Promise<void> {
    await getPool().query(
      `INSERT INTO price_history
         (product_id, shop_id, region, observed_at, price, original_price, discount_pct, stock, flash_sale, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (product_id, observed_at) DO NOTHING`,
      [
        row.productId,
        row.shopId,
        row.region,
        row.observedAt,
        row.price,
        row.originalPrice,
        row.discountPct,
        row.stock,
        row.flashSale,
        row.source,
      ]
    );
  },

  /** FR-PRICE-001 §1 #6 — last30dMin via continuous aggregate (fast). */
  async getLast30dMin(productId: string): Promise<number | null> {
    const { rows } = await getPool().query<{ m: number | null }>(
      `SELECT MIN(min_price) AS m
         FROM price_history_30min_agg
        WHERE product_id = $1
          AND bucket > NOW() - INTERVAL '30 days'`,
      [productId]
    );
    return rows[0]?.m ?? null;
  },

  /** FR-PRICE-001 §1 #6 — raw history (FR-PRICE-002 §1 #3 caps `raw` to ≤ 7d range; callers enforce). */
  async getHistory(productId: string, from: Date, to: Date): Promise<PricePoint[]> {
    const { rows } = await getPool().query<PricePoint>(
      `SELECT observed_at, price
         FROM price_history
        WHERE product_id = $1
          AND observed_at BETWEEN $2 AND $3
        ORDER BY observed_at ASC`,
      [productId, from, to]
    );
    return rows;
  },

  /** FR-PRICE-001 §1 #6 — composite stats from the 30-min agg + a 7-day window. */
  async getStats(productId: string): Promise<PriceStats> {
    const { rows } = await getPool().query<{
      last_30d_min: number | null;
      last_30d_max: number | null;
      last_7d_avg: number | null;
      observation_count: number;
    }>(
      `SELECT
         MIN(min_price)                     AS last_30d_min,
         MAX(max_price)                     AS last_30d_max,
         (SELECT AVG(avg_price)::INTEGER
            FROM price_history_30min_agg
           WHERE product_id = $1
             AND bucket > NOW() - INTERVAL '7 days') AS last_7d_avg,
         COALESCE(SUM(observation_count), 0) AS observation_count
       FROM price_history_30min_agg
       WHERE product_id = $1
         AND bucket > NOW() - INTERVAL '30 days'`,
      [productId]
    );
    const r = rows[0];
    return {
      last30dMin: r?.last_30d_min ?? null,
      last30dMax: r?.last_30d_max ?? null,
      last7dAvg: r?.last_7d_avg ?? null,
      observationCount: Number(r?.observation_count ?? 0),
    };
  },

  /** FR-PRICE-002 §3 — bucketed query used by the chart endpoint. */
  async getBucketedHistory(args: {
    productId: string;
    from: Date;
    bucketInterval: "30 minutes" | "1 hour" | "6 hours" | "1 day";
  }): Promise<Array<{ t: Date; p: number; p_min: number; p_max: number }>> {
    const { productId, from, bucketInterval } = args;
    const { rows } = await getPool().query<{
      t: Date;
      p: number;
      p_min: number;
      p_max: number;
    }>(
      `SELECT
         time_bucket($1::interval, bucket) AS t,
         AVG(avg_price)::INTEGER           AS p,
         MIN(min_price)                    AS p_min,
         MAX(max_price)                    AS p_max
       FROM price_history_30min_agg
       WHERE product_id = $2 AND bucket >= $3
       GROUP BY t
       ORDER BY t ASC`,
      [bucketInterval, productId, from]
    );
    return rows;
  },

  /** Transactional helper for callers that need atomic multi-statement work. */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },

  /** Test/teardown helper. */
  async close(): Promise<void> {
    if (_pool) {
      await _pool.end();
      _pool = null;
    }
  },

  /** Raw query escape hatch for migrations / ad-hoc. */
  query<T extends Record<string, any> = Record<string, any>>(sql: string, params: unknown[] = []) {
    return getPool().query<T>(sql, params as any[]);
  },
};
