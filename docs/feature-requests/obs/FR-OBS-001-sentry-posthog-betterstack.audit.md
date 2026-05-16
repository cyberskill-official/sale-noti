---
fr_id: FR-OBS-001
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

FR-OBS-001 ships ship-grade after two rounds. Every other FR's Sentry-tag, PostHog event, and health monitoring depends on this foundation — if PII-redaction is weak here, every consumer FR leaks; if correlation IDs aren't propagated, every incident is harder to debug; if the daily metrics digest is missing, plan §I targets go uncaught for weeks.

Round-1 (6 issues): correlation-ID propagation across pillars, pii-redactor scope (just email vs full PII set incl. phone/IP/auth-cookies), breadcrumb scrubbing for sensitive query params, opt-out enforcement, terraform-versioned flags, runbook for PII leak.
Round-2 (5 issues): health endpoint timeout behavior, dual Sentry projects rationale, daily-digest insight-ID drill-down, session-replay decision, BullMQ correlation inheritance.

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Correlation ID propagation missing across pillars
- **severity:** error · **rule_id:** debuggability
- **status:** RESOLVED — §1 #25 + #26 ULID-based correlationId at edge → API middleware → Sentry tag → PostHog property → BullMQ job data; AC18-AC20 verify.

### ISS-002 — PII redactor scope incomplete (only email)
- **severity:** error · **rule_id:** pii-correctness
- **status:** RESOLVED — §1 #5 + §6 `pii-redactor.ts` covers email + IP + VN phone + auth cookies; recursive scrubObject for nested contexts; AC5-AC8, AC22 verify each redaction.

### ISS-003 — Breadcrumbs leak sensitive query params (token, code, secret)
- **severity:** warning · **rule_id:** pii-correctness
- **status:** RESOLVED — §1 #6 + §6 `beforeBreadcrumb` regex strip; covers `?token=`, `?code=`, `?t=`, `?secret=`, `?password=`.

### ISS-004 — Analytics opt-out not enforced server-side
- **severity:** warning · **rule_id:** compliance
- **status:** RESOLVED — §1 #24 + §6 `userOptOut` parameter; AC17 verifies no-op when opted out.

### ISS-005 — Feature flags not version-controlled
- **severity:** warning · **rule_id:** ops-correctness
- **status:** RESOLVED — §1 #12 + §6 Terraform `posthog_feature_flag` resources; §10 row 15 documents manual UI changes flagged.

### ISS-006 — PII-leak response runbook missing
- **severity:** error · **rule_id:** compliance + ops-readiness
- **status:** RESOLVED — §1 #28 + `docs/obs/runbook-pii-leak.md`: detect → purge → notify → file with A05 if material.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Health endpoint slow check could timeout the request
- **severity:** warning · **rule_id:** correctness
- **status:** RESOLVED — §1 #18 + §6 `Promise.race` with 1s timeout per sub-check; overall < 1500ms.

### ISS-008 — Two Sentry projects rationale unclear
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #1 + §2 explanation: separate web vs api projects for attributable error volumes + distinct alert rules + cleaner triage.

### ISS-009 — Daily digest hard to drill down (no insight IDs)
- **severity:** info · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #22 explicit: digest metrics MUST cite PostHog Insight ID for drill-down; §8 example shows `[insight 5829]` annotation.

### ISS-010 — Session replay decision deferred without explicit reasoning
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §9 Q6 explicit: disabled at MVP due to PII-leak surface; revisit at P2 with redaction config.

### ISS-011 — BullMQ jobs don't inherit correlationId
- **severity:** warning · **rule_id:** debuggability
- **status:** RESOLVED — §1 #26 + AC20: worker errors include inherited `correlationId` tag; FR-WORKER-001 cross-references.

## §4 — Strengths preserved

- **Three-pillar approach** (Sentry + PostHog + Better Stack) covers errors + analytics + uptime/logs with free-tier budgets large enough for MVP and P1.
- **PII-redaction at SDK boundary** (`beforeSend`/`beforeBreadcrumb`/posthog wrapper) means PII never leaves our process; compliance defensible regardless of vendor's internal handling.
- **Correlation-ID ULID propagation** across all three pillars converts "scattered events across 3 tools" into "one trace, three views" — the single highest-leverage observability investment.
- **Two separate Sentry projects** (web + api) keep error volumes attributable and enable distinct alert rules + sample rates per service.
- **Terraform-versioned PostHog flags** prevent the "what flipped last Tuesday at 2pm?" mystery; manual UI changes flagged in audit.
- **Daily metrics digest with PostHog Insight IDs** makes every reported metric drill-downable; founder accountability is built in.
- **Better Stack heartbeats for BullMQ crons** plus health endpoint with JSON-body assertion catches dependency-degraded-but-server-up scenarios that pure HTTP-status monitoring misses.
- **§10 has 17 failure-mode rows** including the subtle "Vercel cold-start delays Sentry init", "DSR delete cron hash collision", and "Sentry beforeBreadcrumb over-redacts a useful field" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This FR underwrites every downstream FR's observability needs. The PII-redactor + correlation propagation + free-tier budget tracking together form the operational substrate for the entire platform. Plan §C10 "bắt buộc thêm" framing is correctly load-bearing — without OBS, FR-LEGAL-001 breach detection can't fire, plan §I metrics are invisible, and incident response is blind.

---

*End of FR-OBS-001 audit (round 2 final). Last revised: 2026-05-16.*
