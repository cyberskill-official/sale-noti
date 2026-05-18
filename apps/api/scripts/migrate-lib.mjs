import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function splitMigrationSql(sql) {
  return sql
    .split(/^\s*--\s*@SEPARATOR.*$/gm)
    .map((block) => block.trim())
    .filter(Boolean);
}

export async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function applyMigrations({ client, migrationsDir, logger = console }) {
  await ensureMigrationTable(client);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await client.query("SELECT name FROM _migrations");
  const appliedSet = new Set(applied.map((r) => r.name));

  let appliedCount = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      logger.log(`✓ ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const blocks = splitMigrationSql(sql);
    logger.log(`→ applying ${file} (${blocks.length} block${blocks.length === 1 ? "" : "s"}) …`);

    for (let index = 0; index < blocks.length; index++) {
      try {
        await client.query(blocks[index]);
      } catch (e) {
        logger.error(`✗ ${file} block ${index + 1}/${blocks.length} failed:`, e.message);
        throw e;
      }
    }

    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    appliedCount++;
    logger.log(`✓ ${file} applied`);
  }

  return { appliedCount, alreadyAppliedCount: appliedSet.size };
}
