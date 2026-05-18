# FR-WORKER-002 Live Validation Handoff

FR-WORKER-002 is locally implemented and mock-tested. Completion requires live infrastructure proof.

## Required Secrets

Provide these values in Doppler or the local shell:

```bash
MONGODB_URI=mongodb+srv://...
REDIS_URL=rediss://default:<password>@<host>:6380
SHOPEE_AFFILIATE_APP_ID=...
SHOPEE_AFFILIATE_APP_SECRET=...
SHOPEE_RATE_LIMIT_PER_MIN=1000
SENTRY_DSN=...
POSTHOG_PROJECT_API_KEY=...
POSTHOG_HOST=https://app.posthog.com
```

## Live Validation Commands

```bash
pnpm --filter @salenoti/api typecheck
pnpm --filter @salenoti/api test
pnpm --filter @salenoti/api test:e2e
pnpm --filter @salenoti/api build
MONGODB_URI="$MONGODB_URI" pnpm salenoti-cli scheduler force-tier 123456-987654 hot --reason "FR-WORKER-002 live validation"
pnpm --filter @salenoti/api dev
```

## Seed Payload For Scheduler Load Proof

Run this in `mongosh "$MONGODB_URI"` against the `salenoti` database. Replace the shop/item ranges if they collide with real data.

```javascript
function scheduleHash(productId) {
  let h = 0;
  for (let i = 0; i < productId.length; i++) h = (h * 31 + productId.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const now = new Date();
const rows = [];
for (let i = 0; i < 100; i++) {
  const productId = `900001-${100000 + i}`;
  rows.push({
    shopId: 900001,
    itemId: 100000 + i,
    trackPriority: "hot",
    _scheduleHash: scheduleHash(productId),
    createdAt: now,
    updatedAt: now,
  });
}
for (let i = 0; i < 1000; i++) {
  const productId = `900002-${200000 + i}`;
  rows.push({
    shopId: 900002,
    itemId: 200000 + i,
    trackPriority: "mid",
    _scheduleHash: scheduleHash(productId),
    createdAt: now,
    updatedAt: now,
  });
}
for (let i = 0; i < 10000; i++) {
  const productId = `900003-${300000 + i}`;
  rows.push({
    shopId: 900003,
    itemId: 300000 + i,
    trackPriority: "low",
    _scheduleHash: scheduleHash(productId),
    createdAt: now,
    updatedAt: now,
  });
}

db.products.insertMany(rows, { ordered: false });
db.products.createIndex({ trackPriority: 1, _scheduleHash: 1 }, { name: "scheduler_priority" });
```

## Required Evidence To Unblock Completion

- BullMQ `price-check` queue shows scheduler-created jobs and does not exceed `SHOPEE_RATE_LIMIT_PER_MIN`.
- PostHog receives `scheduler_tier_health` with `tier`, `scheduled`, `succeeded`, `failed`, and `current_depth`.
- A forced override command updates a real product, and `priorityOverride.expiresAt` is 24h ahead unless `--hours` is supplied.
- A Shopee sandbox/live `429` or simulated service-unavailable response retries with exponential backoff and reaches the 5-attempt cooldown path.
- Sentry receives warning-level `shopee_repeated_failure` for the cooldown path.
