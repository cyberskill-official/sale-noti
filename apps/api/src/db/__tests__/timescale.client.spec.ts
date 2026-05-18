import { afterEach, describe, expect, it, vi } from "vitest";
import { TimescaleClient, type PriceHistoryRow } from "../timescale.client";

function makeRow(overrides: Partial<PriceHistoryRow> = {}): PriceHistoryRow {
  return {
    productId: "shop-1-item-1",
    shopId: 1,
    region: "VN",
    observedAt: new Date("2026-05-18T00:00:00.000Z"),
    price: 100_000,
    originalPrice: 150_000,
    discountPct: 33,
    stock: 10,
    flashSale: false,
    source: "affiliate_api",
    ...overrides,
  };
}

function makeHarness(queryImpl?: (sql: string, params?: unknown[]) => Promise<any>) {
  const pgClient = {
    query: vi.fn(queryImpl ?? (async () => ({ rows: [], rowCount: 1 }))),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => pgClient),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
  };
  const telemetry = {
    sentry: { captureException: vi.fn() },
    posthog: { capture: vi.fn() },
  };
  const client = new TimescaleClient(pool as any, telemetry as any);
  return { client, pool, pgClient, telemetry };
}

describe("FR-PRICE-001 — TimescaleClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts one price observation with ON CONFLICT idempotency", async () => {
    const { client, pgClient } = makeHarness();

    await client.insertPriceHistory(makeRow());

    expect(pgClient.query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (product_id, observed_at) DO NOTHING"),
      expect.arrayContaining([
        "shop-1-item-1",
        1,
        "VN",
        expect.any(Date),
        100_000,
        150_000,
        33,
        10,
        false,
        "affiliate_api",
      ]),
    );
  });

  it("batch inserts up to 1000 rows in a single multi-VALUES statement", async () => {
    const { client, pgClient } = makeHarness(async () => ({ rows: [], rowCount: 998 }));
    const rows = Array.from({ length: 1000 }, (_, i) => makeRow({ productId: `pid-${i}` }));

    const result = await client.insertPriceHistoryBatch(rows);

    expect(result).toEqual({ inserted: 998, conflicted: 2 });
    expect(pgClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pgClient.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("VALUES ($1, $2, $3");
    expect(sql).toContain("$9991, $9992, $9993");
    expect(sql).toContain("ON CONFLICT (product_id, observed_at) DO NOTHING");
    expect(params).toHaveLength(10_000);
  });

  it("rejects oversized batches before acquiring a pool connection", async () => {
    const { client, pool } = makeHarness();
    const rows = Array.from({ length: 1001 }, (_, i) => makeRow({ productId: `pid-${i}` }));

    await expect(client.insertPriceHistoryBatch(rows)).rejects.toThrow("BATCH_TOO_LARGE");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("uses the aggregate for 30min/6h/24h history and rejects broad raw reads", async () => {
    const { client, pgClient } = makeHarness(async () => ({
      rows: [{ observed_at: new Date(), price: 123 }],
      rowCount: 1,
    }));
    const from = new Date("2026-05-01T00:00:00.000Z");
    const to = new Date("2026-05-18T00:00:00.000Z");

    await expect(client.getHistory("pid", from, to, "raw")).rejects.toThrow("RAW_RESOLUTION_TOO_BROAD");
    await client.getHistory("pid", from, to, "6h");

    expect(pgClient.query).toHaveBeenCalledWith(expect.stringContaining("FROM price_history_30min_agg"), [
      "6 hours",
      "pid",
      from,
      to,
    ]);
  });

  it("captures DB errors with redacted SQL template and no parameter values", async () => {
    const err = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    const { client, telemetry } = makeHarness(async () => {
      throw err;
    });

    await expect(client.insertPriceHistory(makeRow({ productId: "secret-product-id" }))).rejects.toThrow(
      "connection refused",
    );

    expect(telemetry.sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({
          fr: "FR-PRICE-001",
          op: "insertPriceHistory",
          "db.error.code": "ECONNREFUSED",
        }),
        contexts: {
          db: expect.objectContaining({
            statement: expect.not.stringContaining("secret-product-id"),
          }),
        },
      }),
    );
  });

  it("emits a PostHog pool saturation metric when connection acquisition waits over 1s", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(1001);
    const { client, telemetry } = makeHarness();

    await client.getLast30dMin("pid");

    expect(now).toHaveBeenCalled();
    expect(telemetry.posthog.capture).toHaveBeenCalledWith("timescale_pool_saturation", {
      op: "getLast30dMin",
      wait_ms: 1001,
    });
  });
});
