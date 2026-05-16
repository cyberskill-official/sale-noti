---
fr_id: FR-PRICE-001
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.5/10
score_post_revision_1: 9.0/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 11
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-PRICE-001 ships ship-grade after two rounds. This hypertable is the load-bearing time-series substrate for the entire price-tracking system — every read path (FR-PRICE-002 chart, FR-WATCH-002 trigger eval, FR-AFF-003 30-day-low badge) and every write path (FR-AFF-003 dual-write outbox, FR-WORKER-002 scheduled polls) terminates here. A single design error compounds across all of them.

Round-1 (6 issues): idempotency on dual-write retry, continuous-aggregate refresh missing, source enum drift, retention bounds undocumented, pool-exhaustion path, batch-insert performance contract. Round-2 (5 issues): migration idempotency under partial-success, sentry parameter-leak risk, raw-resolution range cap, flash_sale partial index, timezone-handling specification.

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Idempotency on retry (dual-write outbox pattern)
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #6 + §6 `ON CONFLICT (product_id, observed_at) DO NOTHING`; AC6 verifies; §10 row 4 documents.

### ISS-002 — Continuous aggregate refresh policy missing
- **severity:** error · **rule_id:** performance-correctness
- **status:** RESOLVED — §1 #4 + §3 `add_continuous_aggregate_policy` 15-min schedule_interval; AC4 verifies aggregate visibility within 16 min.

### ISS-003 — Source field free-text would drift over time
- **severity:** warning · **rule_id:** schema-discipline
- **status:** RESOLVED — §1 #9 + §3 `CHECK (source IN ('affiliate_api','extension_dom','manual','replay'))`; AC7 verifies constraint violation.

### ISS-004 — Retention bounds undocumented (raw vs aggregate)
- **severity:** warning · **rule_id:** ops-readiness
- **status:** RESOLVED — §1 #5 + §3 two retention policies (730d raw, 90d agg); AC5 verifies chunk eviction; §2 reasoning paragraph documents PDPL band alignment.

### ISS-005 — Pool exhaustion path silent
- **severity:** warning · **rule_id:** ops-correctness
- **status:** RESOLVED — §1 #11 + §6 `_withMetrics` saturation event + §10 row 6 + connectionTimeoutMillis 5s explicit.

### ISS-006 — Batch insert performance contract missing
- **severity:** warning · **rule_id:** scale-correctness
- **status:** RESOLVED — §1 #8 explicit 1000-row cap + multi-VALUES INSERT requirement; AC10 verifies < 800ms p95; AC11 verifies oversized batch rejection.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Migration idempotency under partial-success deploys
- **severity:** warning · **rule_id:** deployment-reliability
- **status:** RESOLVED — §1 #12 + §3 `-- @SEPARATOR` blocks each with `IF NOT EXISTS` / `if_not_exists => TRUE`; AC14 verifies double-run safety; §10 row 9 documents.

### ISS-008 — Sentry parameter-leak risk on DB errors
- **severity:** error · **rule_id:** pii-correctness
- **status:** RESOLVED — §1 #10 + §6 `_captureDbError` redacts to SQL template + error code only; FR-OBS-001 cross-reference established.

### ISS-009 — Raw-resolution query could DoS the hypertable
- **severity:** warning · **rule_id:** scale-correctness
- **status:** RESOLVED — §1 #6 `getHistory` enforces `raw` only for ≤7-day range + AC12 verifies `RAW_RESOLUTION_TOO_BROAD` rejection.

### ISS-010 — flash_sale trigger eval cost at scale
- **severity:** info · **rule_id:** performance
- **status:** RESOLVED — §1 #15 + §3 `idx_price_history_flash_sale` partial index + AC15 verifies index use + §11 note explains 20x size reduction.

### ISS-011 — Timezone handling not specified (client local → DB UTC)
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #13 explicit `TIMESTAMPTZ` + UTC `Date` requirement; AC16 verifies cross-TZ stability; §10 row 10.

## §4 — Strengths preserved

- **§3 SQL migration is fully idempotent** under partial-success deploys — every `CREATE`, `add_*_policy`, and materialized view uses `IF NOT EXISTS` / `if_not_exists => TRUE`. The `-- @SEPARATOR` mechanism handles Timescale's non-transactional DDL constraints.
- **30-min continuous aggregate aligned with FR-WORKER-002 hot tier cadence** — query latency for `lowest_30d` trigger is < 10ms (aggregate) vs ~300ms (raw scan), enabling trigger eval at MVP scale of 5M rows/30d.
- **INTEGER VND price storage** matches plan §C3 schema decision; 5-10x faster arithmetic vs NUMERIC, simpler TypeScript bindings.
- **Composite PK `(product_id, observed_at)` doubles as primary read index** — Timescale hypertables require time-column in PK, and our most-common query pattern (one product over time) hits it directly.
- **Partial index on `flash_sale = true`** is a deliberate optimization: ~5% of observations are flash sales, so the partial index is ~20x smaller than a full index while serving FR-WATCH-002's flash_sale trigger.
- **§10 has 16 failure-mode rows** including the subtle "schema drift between migration and runtime" + "Sentry rate-limit storm" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This FR blocks FR-PRICE-002 (chart API), FR-WATCH-002 (`lowest_30d` trigger), and FR-AFF-003 (offer-resolver dual-write outbox). The hypertable is the single most-depended-on infrastructure piece in P1 — every consumer reads or writes here.

---

*End of FR-PRICE-001 audit (round 2 final). Last revised: 2026-05-16.*
