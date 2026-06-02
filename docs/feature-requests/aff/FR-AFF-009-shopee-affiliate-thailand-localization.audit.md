---
fr_id: FR-AFF-009
audited: 2026-06-02
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 6.9/10
score_post_revision_1: 8.8/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 2
issues_critical: 0
template: engineering-spec@1
---

## §1 - Verdict summary

The draft now closes the mobile runtime path and the type-surface verification gap. `apps/mobile/src/disclosure.ts` gives the app an explicit locale resolver, `apps/mobile/src/__tests__/disclosure.spec.ts` moves the type/assertion coverage into a real test file, and the mobile shim contract now mirrors the full shared disclosure package surface including the Thai exports.

## §2 - Round-1 findings

- **ISS-001 (resolved)** `apps/mobile/App.tsx` now has an explicit runtime locale path through `apps/mobile/src/disclosure.ts`, so Thai users are routed to the Thai branch instead of staying on the hard-coded Vietnamese copy.
- **ISS-002 (resolved)** The mobile type-surface check now lives in `apps/mobile/src/__tests__/disclosure.spec.ts`, which is a real executable test file, and the mobile shim contract now mirrors the shared disclosure exports.

## §3 - Strengths preserved

- The draft correctly keeps Thailand as a single first-market slice instead of trying to solve PH/MY/ID at the same time.
- The shared disclosure package remains the right place for canonical text and ethical principles.
- The KOC roster is intentionally read-only and non-secret, which keeps the localization slice away from PII and scraping risk.
- The web `disclosureFor(locale)` helper is the right consumer-facing seam for localized disclosure rendering.

## §4 - Final verdict

**Score = 10/10.** Ship.

*End of FR-AFF-009 round-2 audit.*
