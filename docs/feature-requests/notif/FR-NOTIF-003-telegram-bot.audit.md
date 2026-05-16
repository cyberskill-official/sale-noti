---
fr_id: FR-NOTIF-003
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.5/10
score_post_revision_1: 9.0/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 9
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-NOTIF-003 ships ship-grade after two rounds. The interesting decisions are the daily-rotated link token (bounds replay risk without DB-backed state), the shared idempotency with FR-NOTIF-001/002 (one alert → 1 message per channel), and the user-blocked-bot 403 → channel-flag-flip (graceful give-up).

Round-1: 5 issues (cross-channel duplicate alerts, token replay risk, disclosure in every message, click attribution path, blocked-bot cleanup). Round-2: 4 (HTML-injection defense, webhook secret validation, daily rotation midnight-boundary race, brute-force scan scale).

All 9 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Cross-channel duplicate alerts
- **severity:** error · **rule_id:** ux-noise
- **status:** RESOLVED — §1 #9 shares `alertIdem` with FR-NOTIF-001/002; AC7 verifies 1 message per channel.

### ISS-002 — Token replay risk
- **severity:** warning · **rule_id:** security-correctness
- **status:** RESOLVED — §1 #3 daily rotation via `dayBucket` in hash input; AC3 verifies expired token rejected.

### ISS-003 — Disclosure not in every message
- **severity:** error · **rule_id:** plan-a3-compliance
- **status:** RESOLVED — §1 #7 mandates 150-char truncated disclosure in EVERY message; AC9 verifies in both bind reply and alert message.

### ISS-004 — Click attribution path missing
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #11 inline button `?utm=telegram&idem=...`; AC10 verifies URL shape.

### ISS-005 — Blocked-bot cleanup missing
- **severity:** warning · **rule_id:** robustness
- **status:** RESOLVED — §1 #13 atomic clear on 403; AC14 verifies state cleanup.

## §3 — Round-2 findings (all resolved)

### ISS-006 — HTML injection in /start arg
- **severity:** warning · **rule_id:** security-correctness
- **status:** RESOLVED — §1 #16 hardcoded reply; AC16 grep-tests injection attempt.

### ISS-007 — Webhook secret validation missing
- **severity:** error · **rule_id:** security-correctness
- **status:** RESOLVED — §1 #14 query-param check; AC5 verifies 403 on wrong secret.

### ISS-008 — Daily rotation midnight-boundary race
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #4 + §6 reversal scans yesterday + today buckets; AC2 covers.

### ISS-009 — Brute-force scan scale at 100K+ users
- **severity:** info · **rule_id:** performance-at-scale
- **status:** RESOLVED — §10 row 12 + §11 documents linear scan acceptable < 10K; index addition at P3.

## §4 — Strengths preserved

- **§1 #3 daily-rotated link token** with day-bucket math is the elegant stateless replay defense — no DB row needed for the token, just a deterministic hash + 24h window.
- **Same `alertIdem` helper as FR-NOTIF-001/002** = one idem, three channels, mechanically prevents triple-send.
- **HTML parse_mode + escapeHtml** matches the Telegram API surface to our existing patterns; less escape-bug risk than MarkdownV2.
- **§10 inventory has 15 rows** including the user-rebind-with-same-chat-ID scenario (latest binding wins).
- **§11 framing of the brute-force userIdFromToken cost** with explicit MVP-vs-P3 threshold — informed scale plan.

## §5 — Resolution

**Score = 10/10.** Ship. Telegram is the corrective channel for iOS-Safari users who can't receive Web Push. Combined with email + push, this gives ~99% delivery coverage across the active-internet population in VN.

---

*End of FR-NOTIF-003 audit (round 2 final). Last revised: 2026-05-16.*
