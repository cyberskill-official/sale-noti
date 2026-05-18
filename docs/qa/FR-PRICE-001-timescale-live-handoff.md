# FR-PRICE-001 Live Timescale Smoke Handoff

**Status:** local mock validation passes. Live hypertable, retention policy, continuous aggregate refresh, and p95 latency validation require a Neon or Timescale database with the Timescale extension enabled.

## Required Doppler/Env Payload

```bash
TIMESCALE_DB_URL=postgres://<user>:<password>@<host>/<db>?sslmode=require
POSTHOG_KEY=<optional staging key>
SENTRY_DSN_API=<optional staging DSN>
```

## Provider Setup

1. Create a Neon Postgres or Timescale Cloud database in Singapore where possible.
2. Enable the TimescaleDB extension for the database.
3. Store `TIMESCALE_DB_URL` in Doppler for the API environment.
4. Confirm the API worker can open outbound TLS to the database host.

## Manual Live Validation Checklist

Run from the repository root:

```bash
doppler run -- node apps/api/scripts/migrate.mjs
TIMESCALE_DB_URL="$TIMESCALE_DB_URL" pnpm --filter @salenoti/api test -- src/db/__tests__/timescale.spec.ts
pnpm --filter @salenoti/api typecheck
pnpm --filter @salenoti/api lint
pnpm --filter @salenoti/api build
```

Then run these SQL checks against the same database:

```sql
SELECT hypertable_name
FROM timescaledb_information.hypertables
WHERE hypertable_name = 'price_history';

SELECT hypertable_name, column_name
FROM timescaledb_information.dimensions
WHERE hypertable_name = 'price_history'
  AND column_name = 'observed_at';

SELECT view_name
FROM timescaledb_information.continuous_aggregates
WHERE view_name = 'price_history_30min_agg';

SELECT *
FROM price_history_health
LIMIT 1;
```

## Expected Final State

- `price_history` exists as a 7-day-chunk Timescale hypertable.
- `price_history_30min_agg` exists as a continuous aggregate with 15-minute refresh policy.
- Raw retention policy is 730 days; aggregate retention policy is 90 days.
- Duplicate `(product_id, observed_at)` inserts are idempotent.
- Unknown `source` values fail the check constraint.
- PostHog receives `timescale_pool_saturation` only when connection wait exceeds 1 second.
- Sentry DB error events include only SQL templates and error codes, not parameter values.
