// FR-PRICE-001 §5 — basic shape tests for the typed client.
// These run against a real TIMESCALE_DB_URL if set; otherwise they skip cleanly.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!process.env.TIMESCALE_DB_URL;
const TEST = HAS_DB ? describe : describe.skip;

let timescale: typeof import("../timescale.client").timescale;

beforeAll(async () => {
  if (HAS_DB) {
    timescale = (await import("../timescale.client")).timescale;
  }
});

afterAll(async () => {
  if (HAS_DB && timescale) await timescale.close();
});

TEST("FR-PRICE-001 — typed client", () => {
  it("AC2: hypertable exists", async () => {
    const r = await timescale.query<{ hypertable_name: string }>(
      `SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name='price_history'`
    );
    expect(r.rowCount).toBeGreaterThan(0);
  });

  it("AC6: UPSERT idempotency", async () => {
    const row = {
      productId: `test-${Date.now()}`,
      shopId: 1,
      region: "VN",
      observedAt: new Date("2026-05-16T10:00:00Z"),
      price: 1000,
      originalPrice: 1500,
      discountPct: 33,
      stock: null,
      flashSale: false,
      source: "affiliate_api" as const,
    };
    await timescale.insertPriceHistory(row);
    await timescale.insertPriceHistory(row);
    const r = await timescale.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM price_history WHERE product_id = $1`,
      [row.productId]
    );
    expect(Number(r.rows[0].count)).toBe(1);
  });

  it("AC7: source enum rejects unknown", async () => {
    await expect(
      timescale.query(
        `INSERT INTO price_history (product_id, shop_id, observed_at, price, source) VALUES ('x', 1, NOW(), 1, 'foo')`
      )
    ).rejects.toThrow();
  });
});
