import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, splitMigrationSql } from "../migrate-lib.mjs";

let tempDir;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("FR-PRICE-001 — separator-aware migration runner", () => {
  it("splits Timescale migration blocks on -- @SEPARATOR markers", () => {
    const blocks = splitMigrationSql(`
      CREATE EXTENSION IF NOT EXISTS timescaledb;
      -- @SEPARATOR
      SELECT create_hypertable('price_history', 'observed_at', if_not_exists => TRUE);
      -- @SEPARATOR optional note
      CREATE INDEX IF NOT EXISTS idx_price_history_shop ON price_history(shop_id);
    `);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("CREATE EXTENSION");
    expect(blocks[1]).toContain("create_hypertable");
    expect(blocks[2]).toContain("CREATE INDEX");
  });

  it("applies each block independently without BEGIN/COMMIT wrapping", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "salenoti-migrations-"));
    writeFileSync(
      join(tempDir, "20260518000000_test.sql"),
      `
      CREATE EXTENSION IF NOT EXISTS timescaledb;
      -- @SEPARATOR
      SELECT create_hypertable('price_history', 'observed_at', if_not_exists => TRUE);
      `,
    );

    const client = {
      query: vi.fn(async (sql, params) => {
        if (sql === "SELECT name FROM _migrations") return { rows: [] };
        return { rows: [], rowCount: params?.length ?? 0 };
      }),
    };
    const logger = { log: vi.fn(), error: vi.fn() };

    await expect(applyMigrations({ client, migrationsDir: tempDir, logger })).resolves.toEqual({
      appliedCount: 1,
      alreadyAppliedCount: 0,
    });

    const sqlCalls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqlCalls).not.toContain("BEGIN");
    expect(sqlCalls).not.toContain("COMMIT");
    expect(sqlCalls.some((sql) => String(sql).includes("CREATE EXTENSION"))).toBe(true);
    expect(sqlCalls.some((sql) => String(sql).includes("create_hypertable"))).toBe(true);
    expect(client.query).toHaveBeenCalledWith("INSERT INTO _migrations (name) VALUES ($1)", [
      "20260518000000_test.sql",
    ]);
  });
});
