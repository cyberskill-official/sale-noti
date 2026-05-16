---
id: FR-WORKER-001
title: "BullMQ + Redis (Upstash) baseline + Bull Board ops dashboard"
module: WORKER
priority: MUST
status: accepted
verify: T
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
related_frs: [FR-WORKER-002, FR-AFF-001, FR-NOTIF-001, FR-OBS-001]
depends_on: [FR-OBS-001]
blocks: [FR-WORKER-002, FR-AFF-001, FR-NOTIF-001]
effort_hours: 5

new_files:
  - apps/api/src/queue/redis.module.ts
  - apps/api/src/queue/redis.client.ts
  - apps/api/src/queue/queues.ts
  - apps/api/src/queue/queue.event-bridge.ts
  - apps/api/src/admin/bull-board.controller.ts
  - apps/api/tests/integration/queue.spec.ts
modified_files:
  - apps/api/src/app.module.ts
  - apps/api/package.json
allowed_tools: ["file_read/write apps/api/**", "bash pnpm install", "bash pnpm test"]
disallowed_tools:
  - "use ioredis directly — MUST go through @nestjs/bullmq adapter (plan §C2 + §C4)"
  - "expose Bull Board without auth"
  - "use Inngest or Trigger.dev (plan §C4: pricing compute-seconds is too expensive at 10K products × 60 min)"
risk_if_skipped: "Plan §C4 is explicit about BullMQ + Redis. Inngest's compute-second pricing breaks unit economics at 10K products × 60 min checks (~170K jobs/day). Without baseline queue, FR-WORKER-002 (adaptive scheduler), FR-AFF-001 (price check), FR-NOTIF-001 (alert dispatch) all block."

---

## §1 — Description (BCP-14 normative)

The API service MUST stand up a production-grade BullMQ + Redis queue layer with operator visibility.

1. **MUST** install `@nestjs/bullmq@^10` + `bullmq@^5` in `apps/api`. The Nest module wraps BullMQ; `ioredis` is the transitive dep and MUST NOT be used directly.
2. **MUST** connect to Upstash Redis via `REDIS_URL` from Doppler (TLS required, `rediss://` scheme). Connection options: `maxRetriesPerRequest: null` (BullMQ requirement), `enableReadyCheck: false`.
3. **MUST** define and register the following four core queues in `apps/api/src/queue/queues.ts`:
   - `price-check` — price polling jobs (FR-AFF-001 producer; consumed by FR-WORKER-002 adaptive scheduler).
   - `alert-dispatch` — outbound notifications (FR-NOTIF-001 producer; consumed by email/push workers).
   - `commission-reconcile` — Shopee Affiliate webhook reconciliation (Phase 2; stub now).
   - `housekeeping` — cron-style jobs (TTL purges, transparency reports, daily metrics digest).
4. **MUST** configure default job options per queue:
   ```ts
   { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: { count: 1000, age: 86400 }, removeOnFail: { count: 5000, age: 7 * 86400 } }
   ```
5. **MUST** mount Bull Board (`@bull-board/express` or NestJS adapter) at `/admin/queues` behind basic auth from Doppler creds (`BULL_BOARD_USER`, `BULL_BOARD_PASS`). Bull Board MUST NOT be exposed without auth.
6. **MUST** bridge BullMQ events (`completed`, `failed`, `stalled`, `progress`) to Sentry breadcrumbs and PostHog events via `queue.event-bridge.ts`. `failed` event on attempt 3 (final) MUST emit a Sentry `error`-level event with tags `{ queue, jobId, jobName, attempt: 3 }`.
7. **MUST** implement worker concurrency per queue: `price-check` concurrency 5, `alert-dispatch` concurrency 10, `commission-reconcile` concurrency 2, `housekeeping` concurrency 1. Tuned for one Railway BE pod with 2 vCPU.
8. **MUST** add the Better Stack heartbeat from FR-OBS-001 §1 #9 (`cron-price-check-tier1-30m` etc.) via housekeeping queue cron `* */30 * * * *` posting to `BETTER_STACK_HEARTBEAT_URL`.
9. **MUST** support graceful shutdown: on `SIGTERM`, call `queue.close()` for each queue with timeout 30s; running jobs finish; stalled jobs get re-queued. Tested via `pkill -SIGTERM <pid>` in CI.
10. **MUST** expose health endpoint `/api/health/queue` returning `{ "redis": <bool>, "queues": { "price-check": { "ready": <bool>, "depth": <number> }, ... } }`.
11. **MUST** rate-limit each queue's producer side at the BullMQ rate-limiter level: `price-check` capped at 1000 jobs/min (matches Shopee API limit budget — FR-WORKER-002 §1 #2 enforces).

---

## §2 — Why this design

**Why BullMQ + Redis (not Inngest, not Trigger.dev, not Temporal):** plan §C4 reviews 4 options. BullMQ wins on cost (Upstash free tier covers 10K req/day on commands/day budget; PAYG after); built-in dashboard via Bull Board; familiar to NestJS-fluent intern team; durable execution at $0 at MVP scale. Inngest's pricing is compute-seconds; at 10K products × 60-min cron = 170K jobs/day at ~500ms each → 85K compute-seconds/day. At Inngest's $20/100K compute-seconds → ~$510/mo just for the queue. BullMQ + Upstash = ~$10/mo. Plan §C4 explicitly recommends BullMQ + Redis for MVP.

**Why Upstash specifically:** plan §C5 lists Upstash for Redis. Pay-per-request model means free tier covers MVP. Alternative Railway Redis on free tier is ephemeral — data loss on redeploys is a no-go for a job queue.

**Why @nestjs/bullmq (not raw bullmq):** plan §C2 says "TypeScript-first, dependency injection, BullMQ adapter chính thức (@nestjs/bullmq)" — match the architectural pattern of the team's NestJS module structure. Direct ioredis usage breaks the abstraction and makes worker tests painful.

**Why concurrency tuned to 2 vCPU pod:** Railway BE plan starts at $5–$20/mo 2vCPU/4GB. Concurrency total = 5 + 10 + 2 + 1 = 18 concurrent jobs. With 30% CPU per IO-bound job that fits with headroom. P2 scaling: split workers into separate Railway services and tune up.

**Why Bull Board (not custom UI):** plan §C4 mentions "Bull Board ops dashboard." 5 minutes to integrate, includes job retry buttons, queue pause/resume — exactly what an on-call engineer needs at 2 AM. Custom UI is wasted effort at MVP.

**Why job options `removeOnComplete: { count: 1000, age: 86400 }`:** keeps Redis memory bounded (Upstash free tier is 256MB on its own commands-based pricing tier). 1000-job rolling window per queue × 4 queues ≈ 4000 retained job records max. Failed jobs kept 7 days for incident review.

---

## §3 — Code shape

### `apps/api/src/queue/redis.module.ts`

```ts
import { BullModule } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";

export function getBullRootConfig(config: ConfigService) {
  const url = new URL(config.getOrThrow("REDIS_URL"));
  return {
    connection: {
      host: url.hostname,
      port: Number(url.port),
      password: url.password,
      tls: url.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 1000, age: 86_400 },
      removeOnFail: { count: 5000, age: 7 * 86_400 },
    },
  };
}
```

### `apps/api/src/queue/queues.ts`

```ts
import { BullModule } from "@nestjs/bullmq";

export const QUEUES = ["price-check", "alert-dispatch", "commission-reconcile", "housekeeping"] as const;
export type QueueName = (typeof QUEUES)[number];

export const QueuesModule = BullModule.registerQueue(
  { name: "price-check", limiter: { max: 1000, duration: 60_000 } },
  { name: "alert-dispatch" },
  { name: "commission-reconcile" },
  { name: "housekeeping" },
);
```

### `apps/api/src/queue/queue.event-bridge.ts`

```ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue, QueueEvents } from "bullmq";
import { sentry } from "../obs/sentry";
import { posthog } from "../obs/posthog";

@Injectable()
export class QueueEventBridge implements OnModuleInit {
  constructor(@InjectQueue("price-check") private q: Queue) {}
  onModuleInit() {
    for (const name of ["price-check","alert-dispatch","commission-reconcile","housekeeping"] as const) {
      const events = new QueueEvents(name, { connection: this.q.opts.connection });
      events.on("failed", ({ jobId, failedReason, prev }) => {
        if (prev === "active") return; // not final failure
        sentry.captureMessage(`Queue job final-failed: ${name}/${jobId}`, {
          level: "error",
          tags: { queue: name, jobId, fr: "FR-WORKER-001" },
          extra: { failedReason },
        });
        posthog.capture("queue_job_failed", { queue: name, jobId, reason: failedReason });
      });
      events.on("stalled", ({ jobId }) => {
        sentry.captureMessage(`Queue job stalled: ${name}/${jobId}`, { level: "warning", tags: { queue: name, jobId } });
      });
    }
  }
}
```

### `apps/api/src/admin/bull-board.controller.ts`

```ts
import { BullBoardModule } from "@bull-board/nestjs";
import { ExpressAdapter } from "@bull-board/express";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import basicAuth from "express-basic-auth";

// Wire under /admin/queues with basic auth from env
// (see Nest module setup in app.module.ts)
```

---

## §4 — Acceptance criteria

1. `pnpm test integration/queue` passes: all 4 queues register and accept a job.
2. Submit a job to `price-check` → consumed by worker → BullMQ event `completed` emitted → Bull Board shows it.
3. Forcibly throw in the worker → `failed` event on attempt 3 → Sentry receives `error`-level event with correct tags.
4. Bull Board `/admin/queues` returns 401 without auth, 200 with valid creds.
5. `/api/health/queue` returns 200 with `{ redis: true, queues: { … depth ≥ 0 } }`.
6. Send `SIGTERM` to API → graceful close completes within 30s; new in-flight job re-queues (no data loss).
7. Submit 1001 jobs to `price-check` in 60s → 1001st is delayed (rate limiter working).
8. Memory check after 5,000 completed jobs: Redis Upstash dashboard shows < 50 MB used.
9. Better Stack heartbeat `cron-price-check-tier1-30m` shows green on dashboard (heartbeat cron successfully posts).

---

## §5 — Verification

```ts
// apps/api/tests/integration/queue.spec.ts
describe("FR-WORKER-001 — queue baseline", () => {
  it("AC2: job round-trip completed event", async () => {
    const done = onceCompleted("price-check");
    await priceCheckQueue.add("test-job", { productId: "fake" });
    const ev = await done;
    expect(ev.jobId).toBeDefined();
  });

  it("AC3: failed event on attempt 3 hits Sentry", async () => {
    process.env.FAIL_TEST_JOB = "1";
    await priceCheckQueue.add("test-fail", {});
    await waitForSentryError({ tags: { queue: "price-check", fr: "FR-WORKER-001" } });
  });

  it("AC4: Bull Board requires auth", async () => {
    const noAuth = await request("/admin/queues").get();
    expect(noAuth.status).toBe(401);
    const withAuth = await request("/admin/queues").get({ auth: { user: env.BULL_BOARD_USER, pass: env.BULL_BOARD_PASS } });
    expect(withAuth.status).toBe(200);
  });

  it("AC6: SIGTERM gracefully drains", async () => {
    await priceCheckQueue.add("slow", { sleepMs: 5000 });
    const t0 = Date.now();
    process.kill(workerPid, "SIGTERM");
    await waitForExit(workerPid);
    expect(Date.now() - t0).toBeLessThan(30_000);
  });

  it("AC7: rate limiter caps at 1000/min", async () => {
    const adds = Array.from({ length: 1001 }, (_, i) => priceCheckQueue.add("rl", { i }));
    await Promise.all(adds);
    // 1001st should be in "delayed" state
    const counts = await priceCheckQueue.getJobCounts("active", "wait", "delayed");
    expect(counts.delayed).toBeGreaterThanOrEqual(1);
  });
});
```

---

## §6 — Implementation skeleton

(see §3 — all four code shapes are the skeleton)

```bash
pnpm add @nestjs/bullmq bullmq @bull-board/nestjs @bull-board/express @bull-board/api express-basic-auth
```

---

## §7 — Dependencies

- FR-OBS-001 (Sentry + PostHog ready for event-bridge).
- Doppler envs: `REDIS_URL`, `BULL_BOARD_USER`, `BULL_BOARD_PASS`, `BETTER_STACK_HEARTBEAT_URL_TIER1`.
- Upstash account + DB created in SG region (lowest latency to Railway SG).

---

## §8 — Example payloads

### Job add

```ts
await priceCheckQueue.add(
  "shopee-price-check",
  { watchlistId: "65f7…", productId: "12345.67890", userId: "65f8…" },
  { jobId: `pc:65f7…:${Date.now()}`, removeOnComplete: 100 }
);
```

### Sentry alert

```
[Sentry][error] Queue job final-failed: alert-dispatch/65f9-xyz
tags: { queue: "alert-dispatch", jobId: "65f9-xyz", fr: "FR-WORKER-001" }
extra: { failedReason: "Resend 503 Service Unavailable" }
```

### Bull Board screen elements

- Queue list: price-check (count: 23 active, 0 failed)
- Per-job rows: id, name, attempt, lastFailedReason, retry button
- Pause/Resume per queue

---

## §9 — Open questions

All resolved:

- **Q1: Hot reload worker on code change?** Resolved → no. Workers are NestJS pods; Railway redeploy handles. Hot-reload in dev is sufficient.
- **Q2: Use BullMQ Flows for multi-step jobs?** Resolved → not yet; over-engineering at MVP. Revisit P3 when commission reconciliation needs parent-child chaining.
- **Q3: Separate worker pod from API pod?** Resolved → same pod at MVP (Railway $5 plan, 2 vCPU). Split when concurrency > 50 or P95 of HTTP responses drops.
- **Q4: Add Redis pubsub for real-time client notifications?** Resolved → not in P0/P1; SSE on demand only.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Upstash quota exceeded (commands/day) | Upstash dashboard alert | Job adds 429; producer retries | Upgrade plan; or shed low-priority queue |
| Redis connection drops | bullmq emits `error` | Worker reconnects with exponential backoff (built-in) | Self-healing |
| Job stalled (worker crash mid-execution) | `stalled` event after lockDuration | Re-queued for another worker | Up to `attempts` retries |
| Final job failure | `failed` event after attempt 3 | Sentry alert; job in `removeOnFail` window for 7d | Operator retries via Bull Board |
| Bull Board exposed without auth | n/a (review) | Catastrophic — operator data leak | basicAuth middleware MUST be present (AC4 enforces) |
| `SIGTERM` doesn't drain (forced kill) | Job re-queued via lock TTL | Re-execution within 30s | Designed-for; tolerable |
| Rate limiter mis-tuned (too low) | Backed-up queue depth grows | Alert on `/api/health/queue` depth threshold | Tune `limiter` value |
| Producer hot loop fills queue (bug) | Job count spike alarms | Pause queue from Bull Board | Find caller; fix |
| QueueEvents subscriber crashes | Bridge silently dies | No Sentry events on job failures | Better Stack heartbeat from QueueEvents (P3 hardening) |
| Doppler rotates `REDIS_URL` mid-flight | Reconnect happens; older jobs may stall | Worker re-attaches | Built-in tolerance |

---

## §11 — Notes

- Concurrency tuning (5/10/2/1) is a starting point; revisit with PostHog metrics after P1 launch.
- Plan §C4 caveats specifically mention "BullMQ có rate limiter built-in" — we use it on `price-check` to keep within Shopee 1000 req/min ceiling.
- Bull Board CSRF surface is minimal but real; if any state-changing UI is added later, add CSRF token middleware.

---

*End of FR-WORKER-001. Status: accepted (10/10).*
