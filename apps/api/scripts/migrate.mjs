#!/usr/bin/env node
/**
 * Lightweight migration runner — applies SQL files in `apps/api/migrations/` in lexicographic order.
 * Tracks applied migrations in `_migrations` table. Idempotent.
 *
 * Usage:
 *   doppler run -- node apps/api/scripts/migrate.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

if (!process.env.TIMESCALE_DB_URL) {
  console.error("TIMESCALE_DB_URL is not set. Run via `doppler run -- node apps/api/scripts/migrate.mjs`.");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.TIMESCALE_DB_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const { rows: applied } = await client.query("SELECT name FROM _migrations");
const appliedSet = new Set(applied.map((r) => r.name));

let appliedCount = 0;
for (const file of files) {
  if (appliedSet.has(file)) {
    console.log(`✓ ${file} (already applied)`);
    continue;
  }
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  console.log(`→ applying ${file} …`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    appliedCount++;
    console.log(`✓ ${file} applied`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`✗ ${file} failed:`, e.message);
    process.exit(1);
  }
}

await client.end();
console.log(`\nDone. ${appliedCount} new migration(s) applied; ${appliedSet.size} already in place.`);
