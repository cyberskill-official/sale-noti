---
fr_id: FR-PRICE-003
audited: 2026-06-09
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.2/10
score_post_revision_1: 9.1/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 2
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-06-09
final_revision: 2026-06-09 (round 2)
---

## §1 — Verdict summary

FR-PRICE-003 now ships as a clean shared scoring contract. The draft keeps the reusable package boundary, preserves the heuristic fallback, and now pins the two missing implementation edges that were open in round 1: where market context comes from and when the dashboard trusts the model-backed recommendation.

Round 1 only had two real blockers: the market-aware clause did not yet explain how the scorer gets a live market value, and the dashboard fallback threshold was still open-ended. Both are now pinned in the draft, which makes the worker path and the analytics route implementable without interpretation drift.

## §2 — Round-1 findings

### ISS-001 — Market context is not wired to the live ingest path
- **severity:** error · **rule_id:** data-path-completeness
- **status:** RESOLVED
- **evidence:** FR-PRICE-003 §1 #4 now says the market passed into `extractDealScoreWindow()` / `scoreDeal()` comes from the caller's canonical market context, with legacy Shopee callers defaulting to `VN`. That closes the source-of-truth gap against the live ingest path in `apps/api/src/affiliate/offer-resolver.service.ts:83`.
- **impact:** The scorer can be wired to a deterministic market source instead of guessing.
- **needed fix:** None; the contract now names the caller-owned market source and fallback behavior.

### ISS-002 — The dashboard model/heuristic cutoff is underspecified
- **severity:** warning · **rule_id:** api-contract
- **status:** RESOLVED
- **evidence:** FR-PRICE-003 §1 #8 and §4 #6 now pin the dashboard cutoff to `confidence >= 0.80` with `modelSource = "ml"`, which sits cleanly beside the existing heuristic in `apps/web/src/server/admin/dashboard.service.ts:461`.
- **impact:** The B2B dashboard has a stable and testable rule for when to trust the model-backed recommendation.
- **needed fix:** None; the caller threshold is explicit.

## §3 — Strengths preserved

- The shared package shape is good: pure helpers, closed score labels, and a fallback heuristic path keep the design reusable.
- The PII guardrails are strong: commission, user IDs, seller email, and buyer-review text stay out of the model inputs.
- The ROC-AUC target is explicit, which gives the ML path a measurable bar before production.
- The model result shape already contains the fields later consumers need, so downstream routes can remain backward compatible.

## §4 — Verdict

**Score = 10/10. PASS.**

The draft is now ready to be treated as the P4 deal-scoring baseline. Its contract is specific enough for the worker, dashboard, and future regional consumers to implement without a second interpretation pass.

*End of FR-PRICE-003 audit (round 2 final).*
