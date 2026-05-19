# FR-WORKER-001 Redis/Bull Board Handoff

**Status:** `BLOCKED: EXTERNAL DEPENDENCY` for live Upstash/Bull Board proof.  
**Local state:** queue config, heartbeat scheduling, event bridge lifecycle, and tests pass.

## Required Secrets

```bash
doppler secrets set \
  REDIS_URL="rediss://default:<password>@<host>.upstash.io:6380" \
  BULL_BOARD_USER="ops" \
  BULL_BOARD_PASS="$(openssl rand -hex 24)" \
  BETTER_STACK_HEARTBEAT_URL="https://uptime.betterstack.com/api/v1/heartbeat/<default>" \
  BETTER_STACK_HEARTBEAT_URL_TIER1="https://uptime.betterstack.com/api/v1/heartbeat/<tier1>"
```

## Live Completion Checklist

1. Start API with Doppler.
2. Confirm `GET /health/queue` returns `redis: true` and all four queues.
3. Confirm `/admin/queues` returns `401` without credentials.
4. Confirm `/admin/queues` returns `200` with `BULL_BOARD_USER/PASS`.
5. Add one `price-check` test job and confirm Bull Board displays it.
6. Force a final failed job and confirm Sentry receives `FR-WORKER-001` queue tags.
7. Confirm Better Stack heartbeat `cron-price-check-tier1-30m` turns green.
