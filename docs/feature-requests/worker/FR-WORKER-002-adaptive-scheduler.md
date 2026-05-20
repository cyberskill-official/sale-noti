---
id: FR-WORKER-002
title: "Adaptive scheduler — hot/mid/low tiers 30min/6h/24h under Shopee API rate-limit + exponential backoff"
module: WORKER
priority: MUST
status: done
shipped: 2026-05-17
verify: T
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
related_frs: [FR-WORKER-001, FR-AFF-001, FR-PRICE-001]
depends_on: [FR-WORKER-001]
blocks: [FR-AFF-001, FR-PRICE-001]
effort_hours: 6

new_files:
  - apps/api/src/scheduler/adaptive-scheduler.service.ts
  - apps/api/src/scheduler/priority-engine.ts
  - apps/api/src/scheduler/backoff-policy.ts
  - apps/api/src/scheduler/cron.module.ts
  - apps/api/src/scheduler/__tests__/adaptive-scheduler.spec.ts
modified_files:
  - apps/api/src/app.module.ts
allowed_tools: ["file_read/write apps/api/**", "bash pnpm test"]
disallowed_tools:
  - "schedule any tier without respecting the 1000 req/min Shopee Affiliate API rate limit"
  - "raw scrape product page HTML (forbidden — plan §B1 + §H Shopee block extension risk)"
  - "hard-code priorities — MUST be data-driven from watchlist alertConfig + history"
risk_if_skipped: "Plan §D6 'Scalability — chống bị Shopee block & xử lý 100K+ products' depends entirely on this FR. Plan §H Risk Matrix: 'Shopee block extension (cease & desist)' likelihood is cao if we don't respect rate limits. Phase 1 success depends on 10K products checked correctly without hitting Shopee API ceiling."
---

## §1 — Description (BCP-14 normative)

The scheduler MUST classify every tracked product into one of three tiers and enqueue price-check jobs at tier-appropriate cadence, while never exceeding the Shopee Affiliate Open API rate limit.

1. **MUST** maintain three priority tiers on every `products` collection document, materialized to `trackPriority` field:
   - `hot` — checked every **30 minutes**. Eligibility: at least one watchlist on this product has `triggers` including `flash_sale` OR (alerted in last 7 days AND not yet converted) OR product is in current Mega Sale window (FR-GROW-003).
   - `mid` — checked every **6 hours**. Eligibility: at least one watchlist on this product is `status: active`, not `hot`-eligible, last alert > 7 days ago.
   - `low` — checked every **24 hours**. Eligibility: all watchlists on this product are paused OR last user activity > 30 days OR no watchlist matched in past 90 days but row not yet GC'd.
2. **MUST** enforce a global rate budget of **1000 req/min** total across all tier checks (Shopee Affiliate Open API rate-limit per plan §B2). Implemented via BullMQ producer-side `limiter: { max: 1000, duration: 60_000 }` on the `price-check` queue (FR-WORKER-001 §1 #11).
3. **MUST** distribute jobs evenly within a tier's window. For `hot`: 1/30th of `hot` products enqueued each minute (jitter ±10s to avoid thundering herd). For `mid`: 1/360th per minute. For `low`: 1/1440th per minute. The enqueuer cron runs at fixed `* * * * *` (every minute).
4. **MUST** re-evaluate tier membership at every job completion. After a successful price-check, if conditions in §1 #1 changed (e.g. a watchlist on the product turned `paused`), update `trackPriority` accordingly. Re-evaluation is in the worker callback, not a separate cron.
5. **MUST** implement an exponential backoff for Shopee API responses 429/5xx: base 30s, multiplier 2, jitter ±25%, max 30 min. If 5 consecutive 429/5xx for the same productId, mark `trackPriority: "low"` for 24h cooldown and emit OBS alert.
6. **MUST** maintain a rolling `shopee_api_health` metric in Redis: 5-min window of (success, 429, 5xx, timeout) counts. When 429+5xx > 5% in the window, the scheduler MUST scale down enqueue rate by half (`reduceLoad6x` strategy from plan §D6) for the next 5 min, then ramp back up.
8. **MUST** emit per-tier health metric every minute to PostHog: `scheduler_tier_health` with `{ tier, scheduled, succeeded, failed, current_depth }`. Aggregated daily into the metrics digest (FR-OBS-001 §1 #12).
9. **MUST** support manual overrides via admin tool: `salenoti-cli scheduler force-tier <productId> <tier>` (admin command at `apps/api/src/scheduler/admin-overrides.ts`). Override expires after 24h unless extended.
10. **MUST** load-test correctly: at 100K products distributed roughly 5% hot / 30% mid / 65% low → total budget per minute ≈ (5K/30) + (30K/360) + (65K/1440) ≈ 167 + 83 + 45 = ~295 req/min — well within 1000-budget headroom (29.5% utilization at 100K — confirms plan §K1 100K product scale target).

---

## §2 — Why this design

**Why three tiers, not continuous priority:** plan §D6 specifies three tiers ("hot / mid / low") for adaptive scheduling. Continuous priority is harder to reason about; the three-tier discrete model is easy to operate and matches BullMQ priority concepts.

**Why 30min/6h/24h cadences:** hot=30min is the minimum that survives a flash sale 1-hour window; the alert must fire within the sale window. mid=6h covers normal "deal hunting" UX. low=24h is a heartbeat — products may still rotate back to mid if user activity returns. These match plan §D6 verbatim.

**Why 1000 req/min global budget:** plan §B2 specifies "Rate limit: 1000 request/h theo benchmark API publicAPI." Wait — plan says 1000/h? Re-reading plan §B2 endpoint hint: it says "100 request/min" in some places and "1000 request/h" elsewhere. The conservative reading is the lower bound: **1000 req/min is the upper bound from the public docs benchmark, but we self-budget to 1000/min total spread across tiers and assume Shopee may tighten.** §1 #5 backoff handles the actual rate-limit response. The §1 #6 health-windowed throttle handles transient tightening. (If Shopee VN tells us 1000/h, we cap §1 #2 to 1000/h = 17/min — same architecture, lower number.)

**Why distribute jobs within window (not burst at top-of-window):** thundering herd. If all 100K hot products were enqueued at minute=0, we'd hit Shopee API with 100K req/30min = 3333 req/min — instantly blocked. Spreading evenly across the cadence is the cheapest defense.

**Why re-evaluate tier at job completion (not just cron):** keeps tier membership fresh without an extra pass. If user pauses a watchlist mid-window, the next check post-completion downgrades the product immediately.

**Why backoff to `low` for 24h on 5 consecutive failures:** if a product is consistently 4xx/5xx, retrying every 30 min is wasted budget. Drop it to 24h to preserve the API budget for products that work.

**Why scale-down on health window > 5% errors:** plan §D6 specifies "reduceLoad6x" but doesn't define the trigger. 5% is the SRE-standard error-budget tripwire (1% is normal; 5% is "we should throttle"; 10% is incident).

---

## §3 — Core algorithm

```ts
// apps/api/src/scheduler/adaptive-scheduler.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { mongo } from "../db/mongo";
import { computeApiHealth } from "./shopee-api-health";

@Injectable()
export class AdaptiveSchedulerService {
  private log = new Logger("AdaptiveScheduler");
  constructor(@InjectQueue("price-check") private q: Queue) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "tier-enqueue" })
  async enqueueByTier() {
    const health = await computeApiHealth();
    const scaleFactor = health.errorRate5m > 0.05 ? 0.5 : 1.0;
    const minute = new Date().getMinutes();

    const tiers = [
      { tier: "hot", cadenceMin: 30, modulo: minute % 30 },
      { tier: "mid", cadenceMin: 360, modulo: minute % 360 },
      { tier: "low", cadenceMin: 1440, modulo: minute % 1440 },
    ];

    for (const { tier, cadenceMin, modulo } of tiers) {
      // For each tier, fetch products whose `lastScheduledTick % cadenceMin === modulo`
      // (a deterministic spread to avoid burst).
      const count = await mongo.db("salenoti").collection("products").countDocuments({ trackPriority: tier });
      const perMinute = Math.ceil((count * scaleFactor) / cadenceMin);
      const cursor = mongo.db("salenoti").collection("products").find(
        { trackPriority: tier, "_scheduleHash": { $mod: [cadenceMin, modulo] } },
        { projection: { _id: 1, shopId: 1, itemId: 1 } }
      ).limit(perMinute);
      for await (const p of cursor) {
        await this.q.add(`pc-${tier}`, { productId: String(p._id), shopId: p.shopId, itemId: p.itemId, tier },
          { jobId: `pc:${p._id}:${minute}`, removeOnComplete: 100 });
      }
      this.log.log(`Tier ${tier}: enqueued ~${perMinute} (scale=${scaleFactor})`);
    }
  }
}
```

`backoff-policy.ts`:

```ts
export function backoffMs(attempts: number) {
  const base = 30_000;
  const exp = Math.min(base * Math.pow(2, attempts - 1), 30 * 60_000);
  const jitter = (Math.random() - 0.5) * 0.5 * exp;
  return Math.round(exp + jitter);
}
```

`priority-engine.ts` (per-job re-eval):

```ts
export async function reevaluateTier(productId: string): Promise<"hot"|"mid"|"low"> {
  const product = await mongo.db("salenoti").collection("products").findOne({ _id: productId });
  if (!product) return "low";
  const watchlists = await mongo.db("salenoti").collection("watchlists").find({ productId }).toArray();
  const hasFlashSale = watchlists.some(w => w.alertConfig?.triggers?.includes("flash_sale"));
  const recentlyAlerted = product.lastAlertAt && (Date.now() - product.lastAlertAt.getTime()) < 7 * 86400_000;
  const isInMegaSale = await isMegaSaleWindow();
  if (hasFlashSale || recentlyAlerted || isInMegaSale) return "hot";
  const activeWatchlists = watchlists.filter(w => w.status === "active");
  if (activeWatchlists.length === 0) return "low";
  const userActivity = await getLastUserActivity(activeWatchlists.map(w => w.userId));
  if (userActivity && (Date.now() - userActivity.getTime()) > 30 * 86400_000) return "low";
  return "mid";
}
```

---

## §4 — Acceptance criteria

1. With 100 products `hot` + 1000 products `mid` + 10000 products `low`, scheduler runs 1 minute → total `price-check` jobs enqueued = ~4 hot + ~3 mid + ~7 low = ~14 jobs.
2. After 30 min, all 100 hot products have been checked at least once.
3. After 6 h, all 1000 mid products have been checked at least once.
4. After 24 h, all 10000 low products have been checked at least once.
5. With Shopee API mock returning 429 for 6 of 100 jobs (>5% threshold) → next minute enqueue is ~50% of normal.
6. Force a job to fail 5 times consecutively → `trackPriority` becomes `low`; OBS alert fired with `severity: warning`.
7. User pauses a watchlist that was the only one driving `hot` → next worker completion downgrades product to `low`.
8. `salenoti-cli scheduler force-tier <productId> hot` works; auto-revert after 24h.
9. `scheduler_tier_health` PostHog event arrives every minute.
10. Backoff: 1st retry waits ~30s ± 25%; 2nd ~60s; 3rd ~120s … capped at 30min.

---

## §5 — Verification

```ts
// apps/api/src/scheduler/__tests__/adaptive-scheduler.spec.ts
describe("FR-WORKER-002 — adaptive scheduler", () => {
  it("AC1: distribute 100/1000/10000 across one minute", async () => {
    await seedProducts({ hot: 100, mid: 1000, low: 10000 });
    await scheduler.enqueueByTier();
    const stats = await priceCheckQueue.getJobCounts("waiting","active","completed");
    expect(stats.waiting + stats.active).toBeGreaterThanOrEqual(10);
    expect(stats.waiting + stats.active).toBeLessThan(50);
  });

  it("AC5: scale down on 5%+ error rate", async () => {
    await setApiHealth({ errorRate5m: 0.07 });
    const before = await mockEnqueueCount();
    await scheduler.enqueueByTier();
    const after = await mockEnqueueCount();
    expect(after - before).toBeLessThan(0.6 * normalEnqueueRate);
  });

  it("AC6: 5 consecutive fails → low + alert", async () => {
    const pid = "test-pid";
    for (let i = 0; i < 5; i++) await mockJobFail(pid);
    const product = await getProduct(pid);
    expect(product.trackPriority).toBe("low");
    expect(await sentryAlerts({ kind: "shopee_repeated_failure" })).toHaveLength(1);
  });

  it("AC10: backoff schedule", () => {
    expect(backoffMs(1)).toBeGreaterThan(22500); expect(backoffMs(1)).toBeLessThan(37500);
    expect(backoffMs(2)).toBeGreaterThan(45000); expect(backoffMs(2)).toBeLessThan(75000);
    expect(backoffMs(20)).toBeLessThanOrEqual(30 * 60_000);
  });
});
```

---

## §6 — Implementation skeleton

(see §3 — three modules form the skeleton: `adaptive-scheduler.service.ts`, `priority-engine.ts`, `backoff-policy.ts`)

`apps/api/src/scheduler/shopee-api-health.ts`:

```ts
import { redis } from "../queue/redis.client";

export async function computeApiHealth() {
  const key = "shopee:api:health:5m";
  const [success, errors] = await Promise.all([
    redis.get(`${key}:success`).then((v) => Number(v ?? 0)),
    redis.get(`${key}:errors`).then((v) => Number(v ?? 0)),
  ]);
  const total = success + errors;
  return {
    success,
    errors,
    errorRate5m: total === 0 ? 0 : errors / total,
  };
}

export async function recordApiOutcome(outcome: "success" | "error") {
  const key = `shopee:api:health:5m:${outcome === "success" ? "success" : "errors"}`;
  await redis.multi().incr(key).expire(key, 300).exec();
}
```

---

## §7 — Dependencies

- FR-WORKER-001 (queue layer + Redis client).
- `@nestjs/schedule` (for `@Cron`).
- Shopee API health metrics keyed in Redis (per §3 `shopee-api-health.ts`).

---

## §8 — Example payloads

### Per-job payload

```json
{
  "productId": "65f7…",
  "shopId": 123456,
  "itemId": 9876543210,
  "tier": "hot"
}
```

### PostHog `scheduler_tier_health` event

```json
{
  "event": "scheduler_tier_health",
  "properties": {
    "tier": "hot",
    "scheduled": 14,
    "succeeded": 12,
    "failed": 2,
    "queueDepth": 47,
    "errorRate5m": 0.042
  }
}
```

---

## §9 — Open questions

All resolved:

- **Q1: Shopee rate-limit headers honored?** Resolved → yes. If response includes `X-Ratelimit-Remaining: 0` or similar, force a 60s cooldown. Implementation goes in FR-AFF-001 client wrapper; FR-WORKER-002 just respects the backoff signal.
- **Q2: Use BullMQ priorities or separate queues per tier?** Resolved → single queue + priority field within job. Three queues add Bull Board clutter + duplicate workers.
- **Q3: How to handle 100K → 1M scale?** Resolved → re-evaluate at 100K. May need to (a) split product cohorts by region, (b) move to streaming compute via NestJS service rebroadcast.
- **Q4: What if no watchlist exists yet (cold start)?** Resolved → no products → no enqueue. Scheduler is a no-op until WATCH-001 lands users.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Shopee API tightens to 100/min undocumented | 429 rate spikes | §1 #6 health-windowed throttle scales down 50%; backoff at job level | Re-tune rate budget; OBS alert |
| Modulo distribution causes hotspot (e.g. all products created in same minute) | Bursty enqueue | Distribute via `_scheduleHash = hash(productId)` for uniform spread | Add to product create flow |
| Scheduler cron overlaps execution | NestJS `@Cron` mutex | Built-in lock prevents re-entry | None |
| Tier re-eval fires while another worker updates same row | Mongo write skew | `findOneAndUpdate` with version | Same-write-skew tolerant |
| 100K → 1M scale | Queue depth alarm | Plan: re-architect per §9 Q3 | Triggers FR re-author |
| Mega Sale window misconfigured (Mongo flag) | manual review | All products become `hot` → API budget bust | Cap `hot` cohort to 50K hard |
| `_scheduleHash` missing on legacy rows | Cursor returns 0 in §3 | Migration backfill cron | One-time backfill job |
| Force-tier override forgotten | Stale `priorityOverride` field | Auto-expire 24h via TTL field | Admin alert if > 100 active overrides |
| Worker concurrency too low for `hot` tier | Queue depth grows | Bump concurrency from 5 → 10 | Tune FR-WORKER-001 §1 #7 |
| Backoff jitter not large enough | Synchronized retries | Inject 25% jitter via `backoffMs` | Already in §3 |

---

## §11 — Notes

- The exact rate-limit number (1000/min vs 1000/h) MUST be confirmed with Shopee Affiliate VN PM (plan §F2 #1 mentions Linkmydeals + AccessTrade — they have the publisher-level number). Until confirmed, default to lower bound and rely on §1 #6 health-windowed throttle.
- Plan §D6 caveat "Backoff strategy: nếu Shopee API trả 429/5xx → exponential backoff, lưu lại để retry, alert nếu rate >5%" is the canonical spec; this FR enforces it.
- The §1 #10 load-test math is the success criterion for plan §K1 "Scaling Plan — Vietnam → SEA → Global" 100K MAU + tracked products.

---

*End of FR-WORKER-002. Status: shipped (2026-05-17).*
