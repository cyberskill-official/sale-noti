---
fr_id: FR-WATCH-005
audited: 2026-06-13
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 9.0/10
score_post_revision_1: 10/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 0
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-06-13
final_revision: 2026-06-13 (round 1)
---

## §1 — Verdict summary

FR-WATCH-005 is implementable as written. The draft keeps the scope read-only, pins the market boundary to the same VN/TH context already used by P4, and reuses product-level price history plus FR-PRICE-003 deal scores instead of introducing new PII or a separate vector stack.

The two consumer-facing seams are also specific enough to build against: a detail route for a single watchlist's smart recommendation, and an optional list-summary flag that can surface cached target-price metadata without changing the default watchlist response.

## §2 — Strengths preserved

- The feature stays within existing workspace boundaries: `packages/*` is already part of the monorepo, so a shared smart-wishlist package fits the current build layout.
- The similarity inputs are constrained to product-level and history-derived signals, which keeps the feature aligned with the trust and privacy fences established by the earlier FRs.
- The spec deliberately degrades to a heuristic path for sparse history and unsupported markets instead of failing the primary watchlist surface.
- The mobile summary path is optional, so the default watchlist contract can stay stable while the new badge behavior is rolled out.

## §3 — Final verdict

**Score = 10/10. PASS.**

The draft is ready to move from authoring to implementation.

*End of FR-WATCH-005 audit (round 1 final).*
