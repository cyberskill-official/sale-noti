---
fr_id: FR-NOTIF-001
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

FR-NOTIF-001 ships ship-grade after two rounds. This is the alert-dispatch foundation that all downstream notification channels (FR-NOTIF-002 push, FR-NOTIF-003 Telegram) extend — the idempotency schema, suppression-list model, audit-row pattern, and per-channel cooldown design defined here are reused. The disclosure-paragraph enforcement (lint + snapshot test) is the single most-important defense against the "Honey-style scandal" reputational risk per plan §A2.

Round-1 (6 issues): per-channel idempotency, suppression-and-still-set-cooldown, Gmail Feb-2024 bulk-sender compliance (List-Unsubscribe + one-click), webhook HMAC verification, email PII redaction in Sentry, Outlook rendering compatibility. Round-2 (5 issues): replay-protection on webhook, deferred-cap urgency-bypass scope, unsubscribe token determinism, TTL purge interaction with late webhooks, subject-line truncation to RFC 5322.

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Single idempotency key for multi-channel job
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #3 + §6 per-channel idem with channel-specific salt; AC2 verifies; AC14 verifies retry-after-partial-failure.

### ISS-002 — Suppressed users keep generating queue jobs (CPU waste)
- **severity:** warning · **rule_id:** scale-correctness
- **status:** RESOLVED — §1 #11 explicit "set cooldown even when suppressed"; AC5 verifies cooldown set after suppression skip.

### ISS-003 — Gmail Feb 2024 bulk-sender rules not addressed
- **severity:** error · **rule_id:** deliverability
- **status:** RESOLVED — §1 #5 + #13 List-Unsubscribe header with both HTTPS and mailto variants + one-click endpoint; AC12 verifies.

### ISS-004 — Webhook HMAC verification not implemented
- **severity:** error · **rule_id:** security
- **status:** RESOLVED — §1 #8 + §6 `verifyResendSignature` with 5-min timestamp skew window; AC10 verifies 401 on bad signature.

### ISS-005 — Email + affiliateLink leak into Sentry error context
- **severity:** error · **rule_id:** pii-correctness
- **status:** RESOLVED — §1 #16 + §6 hashUserId + email_hash redaction; AC16 verifies no `@` in capture; FR-OBS-001 beforeSend cross-reference.

### ISS-006 — Outlook rendering breakage (Outlook uses Word HTML)
- **severity:** warning · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #14 + AC15 enforces `<table>` layout, inline styles only, max-width 600px.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Webhook replay attack window
- **severity:** warning · **rule_id:** security
- **status:** RESOLVED — §6 5-min timestamp skew + webhookEvents collection eventId dedup; AC10 covers.

### ISS-008 — Daily-cap blocks urgent flash_sale alerts
- **severity:** info · **rule_id:** ux-correctness
- **status:** RESOLVED — §9 Q3 / §1 #10 + AC18 explicit deferral to P2; MVP accepts uniform cap as conscious trade-off.

### ISS-009 — Unsubscribe token random or deterministic?
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #13 + §2 explanation: deterministic sha256(userId+watchlistId+SALT) is stable, stateless, self-validating; rotation via SALT change.

### ISS-010 — Late webhook arrival after TTL purge
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §10 row 13 silent drop accepted (TTL 365d > Resend 30d webhook retention window).

### ISS-011 — Subject-line truncation (RFC 5322 78-char recommended)
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #5 + §6 `truncateSubject` 78-char cap with "..." suffix.

## §4 — Strengths preserved

- **Per-channel idempotency with channel-specific salt** — email/push/Telegram each compute independent idem keys from the same job data, so partial-failure retry doesn't double-send any successful channel. Critical for `channels: ["email","push","telegram"]` jobs.
- **Disclosure-paragraph triple-enforcement** (shared constant + ESLint rule + snapshot test) defends the reputation-critical FR-LEGAL-002 §1 #4 ethics rule across drift, copy-paste accidents, and intentional removal.
- **Suppression-list with hash-based PII storage** — emails stored only as `sha256(lowercase(email)+SALT).slice(0,32)`; suppression survives email rotation only if user re-opts-in (intentional re-validation).
- **One-click unsubscribe + HTTPS+mailto dual List-Unsubscribe header** — covers Gmail Feb 2024 bulk-sender ruleset AND legacy MTAs that only honor mailto: form.
- **Webhook HMAC + replay protection** — 5-min timestamp skew + `webhookEvents` dedup makes the endpoint safe even under replay-attack scenarios.
- **Mongo-first dual-write pattern** — DB row inserted before Resend call; idempotency catches retry; webhook reconciliation closes the loop on rare orphan-send cases.
- **§10 has 16 failure-mode rows** including the subtle "Resend domain de-listed" + "Outlook 102KB clipping" + "List-Unsubscribe header strips on some MTAs" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This FR is the foundation for FR-NOTIF-002 (push) and FR-NOTIF-003 (Telegram); they extend the alert-dispatch contract, idempotency schema, and suppression model defined here. The 5K-alerts/250-users / CTR ≥ 25% / D7 ≥ 25% MVP success metrics ALL flow through this dispatch pipeline.

---

*End of FR-NOTIF-001 audit (round 2 final). Last revised: 2026-05-16.*
