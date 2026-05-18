#!/usr/bin/env node
/**
 * Lightweight migration runner — applies SQL files in `apps/api/migrations/` in lexicographic order.
 * Tracks applied migrations in `_migrations` table. Idempotent.
 *
 * Usage:
 *   doppler run -- node apps/api/scripts/migrate.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { applyMigrations } from "./migrate-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

if (!process.env.TIMESCALE_DB_URL) {
  console.error("TIMESCALE_DB_URL is not set. Run via `doppler run -- node apps/api/scripts/migrate.mjs`.");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.TIMESCALE_DB_URL });
await client.connect();

try {
  const result = await applyMigrations({ client, migrationsDir: MIGRATIONS_DIR });
  console.log(
    `\nDone. ${result.appliedCount} new migration(s) applied; ${result.alreadyAppliedCount} already in place.`,
  );
} catch {
  process.exitCode = 1;
} finally {
  await client.end();
}
