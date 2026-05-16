---
fr_id: FR-LEGAL-002
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 8.0/10
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

FR-LEGAL-002 ships ship-grade after two rounds. This is the moral + reputational firewall of the entire product. Honey-style trust collapse (2024) is the cautionary tale; this FR's 7 surfaces + 5 ethical principles + 3 ESLint rules + grep CI gate make the principles enforceable not just by policy but by codebase. Plan §A3 framing ("đây là moat") is correctly load-bearing: every commercial-optimization tradeoff must pass through these principles first.

Round-1 (5 issues): consent storage shape, browser-extension cross-origin ack endpoint, transparency report cadence + content checklist, ESLint rules for principles 3+5, version-bump re-consent flow.
Round-2 (4 issues): canonical-only enforcement (disclosure-import-required rule), localization fallback handling, transparency-report deadline alerting, English text authority disclaimer.

All 9 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Two consents stored as one (privacy + affiliate not separable)
- **severity:** warning · **rule_id:** compliance
- **status:** RESOLVED — §1 #16 separate `privacy_v1` + `affiliate_disclosure_v1` entries in `users.consents[]`; AC10 verifies; withdrawal of one doesn't invalidate the other.

### ISS-002 — Extension onboarding ack endpoint missing
- **severity:** error · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #5 + §6 POST `/api/auth/disclosure-ack` with cross-origin CORS (FR-AUTH-003 pinned-extension-id); AC8 + AC9 verify.

### ISS-003 — Transparency Report content/cadence checklist undefined
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #9 + §8 sample report; AC15 verifies all 9 required fields; §10 row 7 + AC14 cover late-publish alerting.

### ISS-004 — Principles 3 + 5 enforced only by policy (not code)
- **severity:** error · **rule_id:** correctness-at-scale
- **status:** RESOLVED — §1 #11 + #13 ESLint rules `no-auto-apply-coupon` + `no-commission-ranking`; AC12 + AC13 verify rules fail PRs.

### ISS-005 — Version-bump re-consent flow unspecified
- **severity:** warning · **rule_id:** compliance
- **status:** RESOLVED — §1 #14 + AC17: material wording change triggers re-consent; semantic versioning (`v1` → `v2` material, `v1.1` patch).

## §3 — Round-2 findings (all resolved)

### ISS-006 — Disclosure copy duplication outside `disclosure.ts` possible
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #2 + §5 `disclosure-import-required` ESLint rule; AC18 verifies rule fires on hardcoded copy outside `disclosure.ts`.

### ISS-007 — Localization fallback when user locale unknown
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §10 row 17: defaults to Vi (authoritative); §1 #6 + §1 #1 both name Vi as default.

### ISS-008 — Transparency-report deadline alerting missing
- **severity:** warning · **rule_id:** ops-readiness
- **status:** RESOLVED — §10 row 7 + AC14: scheduled cron checks; Sentry alert + founder ping at T+14d post-quarter end.

### ISS-009 — English text not flagged as non-authoritative
- **severity:** info · **rule_id:** legal-correctness
- **status:** RESOLVED — §1 #1 + §1 #4 + §11 note explicit: "Vi is the authoritative version"; English page renders disclaimer.

## §4 — Strengths preserved

- **Code-level enforcement of all 5 principles** via 3 ESLint rules + grep CI gate makes "we won't violate the principles" verifiable continuously, not just at code-review attention moments.
- **Single canonical-copy source** in `disclosure.ts` with import-required lint rule prevents the inevitable drift that always happens when copy lives in N places.
- **7 disclosure surfaces** (listing, onboarding, extension install, every email, every CTA, pre-click interstitial, transparency report) cover FTC "clear and conspicuous" + Chrome Web Store 3/2025 policy + Plan §A2/§A3 anti-Honey lessons.
- **Two separable consents** (privacy + affiliate disclosure) allows users to withdraw one without invalidating the other; PDPL Art. 11 demonstrable-consent compliance.
- **Quarterly Transparency Report with deadline-alerting cron** ensures the rhythm doesn't slip; matches SOC 2 / PCI cadences for forward-compatibility.
- **Pre-click interstitial as a one-time-per-session experience** balances trust-signal strength with UX cost; cookie-tracked so habitual users don't suffer.
- **Open-sourced revenue calculator** turns the formula into an audit asset — anyone with their alert log can verify our commission claims.
- **§10 has 17 failure-mode rows** including subtle "Translation drift Vi vs En", "Transparency report PII accidental leak", and "New affiliate network adds commission range change" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This is the single biggest moat in the product per plan §A3 closing line. The 7-surface coverage + 5-principle ethics + 3 ESLint rules + quarterly transparency cadence create a posture that's hard to fake and easy to verify — exactly the inverse of Honey's collapse model. Combined with FR-LEGAL-001 PDPL compliance, this FR defines what "trustworthy affiliate price-tracker" means in code, copy, and process.

---

*End of FR-LEGAL-002 audit (round 2 final). Last revised: 2026-05-16.*
