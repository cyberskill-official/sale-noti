// FR-PRICE-001 §6 — TimescaleDB typed client.
// Wraps pg Pool with idempotent writes, aggregate reads, and redacted OBS telemetry.
import { Pool, type PoolClient, type QueryResult } from "pg";
import { sentry } from "../obs/sentry";
import { posthog } from "../obs/posthog";

const MAX_BATCH_SIZE = 1000;

export type PriceHistorySource = "affiliate_api" | "extension_dom" | "manual" | "replay";
export type HistoryResolution = "raw" | "30min" | "6h" | "24h";

export type PriceHistoryRow = {
  productId: string;
  shopId: number;
  region: string;
  observedAt: Date;
  price: number;
  originalPrice?: number | null;
  discountPct?: number | null;
  stock?: number | null;
  flashSale: boolean;
  source: PriceHistorySource;
};

export type PricePoint = { observed_at: Date; price: number };

export type PriceStats = {
  last30dMin: number | null;
  last30dMax: number | null;
  last7dAvg: number | null;
  observationCount: number;
};

type PoolLike = Pick<Pool, "connect" | "end" | "on">;
type Telemetry = {
  sentry: typeof sentry;
  posthog: typeof posthog;
};

const INSERT_PRICE_HISTORY_SQL = `INSERT INTO price_history
  (product_id, shop_id, region, observed_at, price, original_price, discount_pct, stock, flash_sale, source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (product_id, observed_at) DO NOTHING`;

const LAST_30D_MIN_SQL = `SELECT MIN(min_price) AS m
  FROM price_history_30min_agg
 WHERE product_id = $1
   AND bucket > NOW() - INTERVAL '30 days'`;

const RAW_HISTORY_SQL = `SELECT observed_at, price
  FROM price_history
 WHERE product_id = $1
   AND observed_at BETWEEN $2 AND $3
 ORDER BY observed_at ASC`;

const BUCKETED_HISTORY_SQL = `SELECT
    time_bucket($1::interval, bucket) AS observed_at,
    AVG(avg_price)::INTEGER AS price
  FROM price_history_30min_agg
 WHERE product_id = $2
   AND bucket BETWEEN $3 AND $4
 GROUP BY observed_at
 ORDER BY observed_at ASC`;

const STATS_SQL = `SELECT
    MIN(min_price) AS last_30d_min,
    MAX(max_price) AS last_30d_max,
    (SELECT AVG(avg_price)::INTEGER
       FROM price_history_30min_agg
      WHERE product_id = $1
        AND bucket > NOW() - INTERVAL '7 days') AS last_7d_avg,
    COALESCE(SUM(observation_count), 0)::INTEGER AS observation_count
  FROM price_history_30min_agg
 WHERE product_id = $1
   AND bucket > NOW() - INTERVAL '30 days'`;

const BUCKET_INTERVALS: Record<Exclude<HistoryResolution, "raw">, "30 minutes" | "6 hours" | "1 day"> = {
  "30min": "30 minutes",
  "6h": "6 hours",
  "24h": "1 day",
};

let _client: TimescaleClient | null = null;

function createPoolFromEnv(): Pool {
  if (!process.env.TIMESCALE_DB_URL) {
    throw new Error("TIMESCALE_DB_URL not set — configure Doppler before calling Timescale.");
  }
  return new Pool({
    connectionString: process.env.TIMESCALE_DB_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

function getClient(): TimescaleClient {
  if (!_client) _client = new TimescaleClient(createPoolFromEnv());
  return _client;
}

function rowParams(row: PriceHistoryRow): unknown[] {
  assertUtcDate(row.observedAt);
  return [
    row.productId,
    row.shopId,
    row.region,
    row.observedAt,
    row.price,
    row.originalPrice ?? null,
    row.discountPct ?? null,
    row.stock ?? null,
    row.flashSale,
    row.source,
  ];
}

function assertUtcDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("INVALID_OBSERVED_AT");
  }
}

export class TimescaleClient {
  constructor(
    private readonly pool: PoolLike,
    private readonly telemetry: Telemetry = { sentry, posthog },
  ) {
    this.pool.on?.("error", (err) => {
      this.captureDbError(err, "pool", "pool_error");
    });
  }

  async insertPriceHistory(row: PriceHistoryRow): Promise<void> {
    await this.queryWithTelemetry("insertPriceHistory", INSERT_PRICE_HISTORY_SQL, rowParams(row));
  }

  async insertPriceHistoryBatch(rows: PriceHistoryRow[]): Promise<{ inserted: number; conflicted: number }> {
    if (rows.length > MAX_BATCH_SIZE) throw new Error(`BATCH_TOO_LARGE: ${rows.length} > ${MAX_BATCH_SIZE}`);
    if (rows.length === 0) return { inserted: 0, conflicted: 0 };

    const columnCount = 10;
    const placeholders = rows
      .map((_, rowIndex) => {
        const base = rowIndex * columnCount;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
      })
      .join(", ");
    const params = rows.flatMap(rowParams);
    const result = await this.queryWithTelemetry(
      "insertPriceHistoryBatch",
      `INSERT INTO price_history
        (product_id, shop_id, region, observed_at, price, original_price, discount_pct, stock, flash_sale, source)
       VALUES ${placeholders}
       ON CONFLICT (product_id, observed_at) DO NOTHING`,
      params,
    );
    return { inserted: result.rowCount ?? 0, conflicted: rows.length - (result.rowCount ?? 0) };
  }

  async getLast30dMin(productId: string): Promise<number | null> {
    const { rows } = await this.queryWithTelemetry<{ m: number | null }>("getLast30dMin", LAST_30D_MIN_SQL, [
      productId,
    ]);
    return rows[0]?.m ?? null;
  }

  async getHistory(
    productId: string,
    from: Date,
    to: Date,
    resolution: HistoryResolution = "30min",
  ): Promise<PricePoint[]> {
    assertUtcDate(from);
    assertUtcDate(to);
    const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (resolution === "raw") {
      if (rangeDays > 7) throw new Error("RAW_RESOLUTION_TOO_BROAD");
      const { rows } = await this.queryWithTelemetry<PricePoint>("getHistory.raw", RAW_HISTORY_SQL, [
        productId,
        from,
        to,
      ]);
      return rows;
    }
    const bucket = BUCKET_INTERVALS[resolution];
    const { rows } = await this.queryWithTelemetry<PricePoint>("getHistory.aggregate", BUCKETED_HISTORY_SQL, [
      bucket,
      productId,
      from,
      to,
    ]);
    return rows;
  }

  async getStats(productId: string): Promise<PriceStats> {
    const { rows } = await this.queryWithTelemetry<{
      last_30d_min: number | null;
      last_30d_max: number | null;
      last_7d_avg: number | null;
      observation_count: number;
    }>("getStats", STATS_SQL, [productId]);
    const r = rows[0];
    return {
      last30dMin: r?.last_30d_min ?? null,
      last30dMax: r?.last_30d_max ?? null,
      last7dAvg: r?.last_7d_avg ?? null,
      observationCount: Number(r?.observation_count ?? 0),
    };
  }

  async getBucketedHistory(args: {
    productId: string;
    from: Date;
    bucketInterval: "30 minutes" | "1 hour" | "6 hours" | "1 day";
  }): Promise<Array<{ t: Date; p: number; p_min: number; p_max: number }>> {
    const { productId, from, bucketInterval } = args;
    assertUtcDate(from);
    const { rows } = await this.queryWithTelemetry<{
      t: Date;
      p: number;
      p_min: number;
      p_max: number;
    }>(
      "getBucketedHistory",
      `SELECT
         time_bucket($1::interval, bucket) AS t,
         AVG(avg_price)::INTEGER           AS p,
         MIN(min_price)                    AS p_min,
         MAX(max_price)                    AS p_max
       FROM price_history_30min_agg
       WHERE product_id = $2 AND bucket >= $3
       GROUP BY t
       ORDER BY t ASC`,
      [bucketInterval, productId, from],
    );
    return rows;
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withClient("withTransaction", async (client) => {
      try {
        await client.query("BEGIN");
        const result = await fn(client as PoolClient);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        this.captureDbError(e, "withTransaction", "transaction");
        throw e;
      }
    });
  }

  async healthCheck(): Promise<{ ok: boolean; latest_observation: Date | null }> {
    try {
      const { rows } = await this.queryWithTelemetry<{ latest_observation: Date | null }>(
        "healthCheck",
        `SELECT * FROM price_history_health LIMIT 1`,
      );
      return { ok: true, latest_observation: rows[0]?.latest_observation ?? null };
    } catch {
      return { ok: false, latest_observation: null };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  query<T extends Record<string, any> = Record<string, any>>(sql: string, params: unknown[] = []) {
    return this.queryWithTelemetry<T>("query", sql, params);
  }

  private async queryWithTelemetry<T extends Record<string, any> = Record<string, any>>(
    op: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    try {
      return await this.withClient(op, (client) => client.query<T>(sql, params));
    } catch (e) {
      this.captureDbError(e, op, sql);
      throw e;
    }
  }

  private async withClient<T>(op: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const waitStartedAt = performance.now();
    const client = await this.pool.connect();
    const waitMs = performance.now() - waitStartedAt;
    if (waitMs > 1000) {
      this.telemetry.posthog.capture("timescale_pool_saturation", {
        op,
        wait_ms: Math.round(waitMs),
      });
    }
    try {
      return await fn(client as PoolClient);
    } finally {
      client.release();
    }
  }

  private captureDbError(err: unknown, op: string, sql: string): void {
    const e = err as { code?: string };
    this.telemetry.sentry.captureException(err, {
      tags: { fr: "FR-PRICE-001", op, "db.error.code": e.code ?? "unknown" },
      contexts: {
        db: {
          op,
          code: e.code ?? "unknown",
          statement: this.redactSqlTemplate(sql),
        },
      },
    });
  }

  private redactSqlTemplate(sql: string): string {
    return sql
      .replace(/'[^']*'/g, "?")
      .replace(/\b\d+\b/g, "?")
      .replace(/\s+/g, " ")
      .trim();
  }
}

export const timescale = {
  insertPriceHistory(row: PriceHistoryRow) {
    return getClient().insertPriceHistory(row);
  },
  insertPriceHistoryBatch(rows: PriceHistoryRow[]) {
    return getClient().insertPriceHistoryBatch(rows);
  },
  getLast30dMin(productId: string) {
    return getClient().getLast30dMin(productId);
  },
  getHistory(productId: string, from: Date, to: Date, resolution?: HistoryResolution) {
    return getClient().getHistory(productId, from, to, resolution);
  },
  getStats(productId: string) {
    return getClient().getStats(productId);
  },
  getBucketedHistory(args: {
    productId: string;
    from: Date;
    bucketInterval: "30 minutes" | "1 hour" | "6 hours" | "1 day";
  }) {
    return getClient().getBucketedHistory(args);
  },
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
    return getClient().withTransaction(fn);
  },
  healthCheck() {
    return getClient().healthCheck();
  },
  close() {
    const client = getClient();
    _client = null;
    return client.close();
  },
  query<T extends Record<string, any> = Record<string, any>>(sql: string, params: unknown[] = []) {
    return getClient().query<T>(sql, params);
  },
};
