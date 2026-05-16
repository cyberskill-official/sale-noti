---
fr_id: FR-WORKER-001
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 8.5/10
score_post_revision_1: 9.5/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 6
issues_critical: 0
template: engineering-spec@1
---

## §1 — Verdict summary

FR-WORKER-001 is ship-grade. Resolved: Bull Board auth gate, graceful shutdown SIGTERM behavior, rate limiter on producer, queue health endpoint, removeOnComplete window bounds.

## §2 — Round-1 findings (resolved)

- **ISS-001 (error)** Bull Board exposed unauthenticated — RESOLVED §1 #5 + AC4 + §10 row 5.
- **ISS-002 (error)** `SIGTERM` not handled → in-flight jobs lost — RESOLVED §1 #9 + AC6.
- **ISS-003 (warning)** No producer rate limit → Shopee API budget bust — RESOLVED §1 #11 + AC7.

## §3 — Round-2 findings (resolved)

- **ISS-004 (info)** Health endpoint shape unspecified — RESOLVED §1 #10 + AC5.
- **ISS-005 (info)** Job retention windows unbounded → Upstash memory blowup — RESOLVED §1 #4 explicit `count`+`age`.
- **ISS-006 (warning)** Stalled-job re-execution path undocumented — BullMQ moves crashed-worker jobs to a stalled list after a configurable interval; the new worker re-executes them. For non-idempotent processors (FR-NOTIF-001 alert dispatch, FR-AFF-002 deeplink creation) this creates a double-send risk. RESOLVED via §1 #7 `stalledInterval: 30_000` + `maxStalledCount: 1` documented as the safe default; downstream FRs MUST enforce per-job idempotency (covered by FR-NOTIF-001 §1 #3 idem keys + FR-AFF-002 §1 #6 SET-NX lease). §10 row 6 documents the cross-FR contract.

## §4 — Strengths preserved

- §2 cost rationale (Inngest $510/mo vs BullMQ+Upstash $10/mo) is the killer decision rationale.
- Per-queue concurrency tuned to 2 vCPU pod is concrete and reviewable.
- §3 code shapes compile directly with NestJS module pattern; intern can follow.
- §6 graceful shutdown ties into the Railway redeploy lifecycle cleanly.

## §5 — Resolution

**Score = 10/10.** Ship. Blocks FR-WORKER-002 (adaptive scheduler builds on this baseline), FR-AFF-001 (price-check job), FR-NOTIF-001 (alert-dispatch job).

---

*End of FR-WORKER-001 audit.*
