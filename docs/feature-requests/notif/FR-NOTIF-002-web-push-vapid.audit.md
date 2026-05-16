---
fr_id: FR-NOTIF-002
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

FR-NOTIF-002 ships ship-grade after two rounds. The single most important design point is the iOS pragmatism (don't prompt where it won't work) — getting this wrong tanks user trust and Chrome's auto-block heuristic permanently disables the prompt for the domain.

Round-1: 5 issues (auto-prompt on page load, no subscription cleanup, no combined cap, no permission-revoke detection, no rate limit on subscribe). Round-2: 4 (FIFO eviction at cap-5, OS-tag idem safety net, 5xx retry semantics, PostHog endpoint redaction).

All 9 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Auto-prompt on page load (Chrome heuristic block risk)
- **severity:** error · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #5 explicit button-gated pattern + §2 paragraph explains the Chrome auto-block consequence.

### ISS-002 — Expired subscription cleanup missing
- **severity:** warning · **rule_id:** robustness
- **status:** RESOLVED — §1 #8 + AC6 cover 410 Gone auto-removal; empty-array flips channel flag off.

### ISS-003 — Combined cap across channels
- **severity:** warning · **rule_id:** ux-noise
- **status:** RESOLVED — §1 #9 shares FR-NOTIF-001 `dailyCount()` helper; AC7 verifies 18+3 = cap reached.

### ISS-004 — Permission-revoke detection
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #11 polls `navigator.permissions.query`; AC8 verifies channel-flip on detect.

### ISS-005 — Subscribe endpoint rate limit
- **severity:** warning · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #12 caps at 5/min/user; AC14 verifies.

## §3 — Round-2 findings (all resolved)

### ISS-006 — FIFO eviction at cap-5 unspecified
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §6 `$slice: -5` keeps newest 5 by addedAt; AC12 verifies.

### ISS-007 — OS-tag idem as safety net not documented
- **severity:** info · **rule_id:** robustness
- **status:** RESOLVED — §1 #7 mandates `tag: <idem>`; §2 paragraph explains why; AC5 verifies OS dedup.

### ISS-008 — 5xx retry semantics
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #14 + AC15 = 3 retries then drop; alert idem prevents future re-dispatch.

### ISS-009 — PostHog endpoint redaction
- **severity:** info · **rule_id:** pdpl-privacy-leak
- **status:** RESOLVED — §1 #13 forbids raw endpoint in events; AC13 grep-tests `fcm.googleapis.com` absence.

## §4 — Strengths preserved

- **§2 iOS pragmatism paragraph** — the right product decision (don't prompt on iOS Safari non-PWA where < 5% conversion + 100% failure = pure UX cost).
- **Shared idempotency across all 3 channels** via FR-NOTIF-001's `alertIdem` helper — one alert event = at most one delivery per channel.
- **§1 #7 `tag: <idem>` OS-level dedup** is the safety net even when app-level idem fails.
- **§10 inventory covers 16 rows** including subtle SW-controller-change and incognito-orphan scenarios.
- **§11 framing of VAPID keys as signing-key-grade trust anchors** — sets the correct rotation cadence (only on compromise).

## §5 — Resolution

**Score = 10/10.** Ship. Web Push covers ~70% of VN active internet population — meaningful coverage with the right opt-in UX. iOS gap is filled by FR-NOTIF-003 Telegram.

---

*End of FR-NOTIF-002 audit (round 2 final). Last revised: 2026-05-16.*
