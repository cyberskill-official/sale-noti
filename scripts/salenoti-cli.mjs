#!/usr/bin/env node
import { createRequire } from "node:module";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { MongoClient, ObjectId } = requireFromApi("mongodb");

const USAGE = `Usage:
  salenoti-cli scheduler force-tier <productId> <hot|mid|low> [--reason <text>] [--hours <n>]

Examples:
  pnpm salenoti-cli scheduler force-tier 123456-987654 hot --reason "mega-sale smoke"
  MONGODB_URI=mongodb://... node scripts/salenoti-cli.mjs scheduler force-tier 123456-987654 low --hours 6`;

const [, , scope, command, productId, tier, ...rest] = process.argv;

if (scope !== "scheduler" || command !== "force-tier" || !productId || !tier) {
  console.error(USAGE);
  process.exit(64);
}

if (!["hot", "mid", "low"].includes(tier)) {
  console.error(`Invalid tier "${tier}". Expected hot, mid, or low.`);
  process.exit(64);
}

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error("MONGODB_URI is required.");
  process.exit(78);
}

function optionValue(name, fallback) {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : fallback;
}

function productFilterFromId(value) {
  const match = value.match(/^(\d+)-(\d+)$/);
  if (match) return { shopId: Number(match[1]), itemId: Number(match[2]) };
  if (ObjectId.isValid(value)) return { _id: new ObjectId(value) };
  return { productId: value };
}

const now = new Date();
const hours = Number(optionValue("--hours", "24"));
if (!Number.isFinite(hours) || hours <= 0) {
  console.error("--hours must be a positive number.");
  process.exit(64);
}
const expiresAt = new Date(now.getTime() + hours * 3_600_000);
const reason = optionValue("--reason", "admin_force_tier");

const client = new MongoClient(mongoUri, { maxPoolSize: 1, serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const result = await client
    .db("salenoti")
    .collection("products")
    .updateOne(productFilterFromId(productId), {
      $set: {
        trackPriority: tier,
        priorityOverride: { tier, forcedAt: now, expiresAt, reason },
        updatedAt: now,
      },
      $unset: { cooldownUntil: "" },
    });

  if (result.matchedCount === 0) {
    console.error(`No product matched ${productId}.`);
    process.exit(66);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        productId,
        tier,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        expiresAt: expiresAt.toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => {});
}
