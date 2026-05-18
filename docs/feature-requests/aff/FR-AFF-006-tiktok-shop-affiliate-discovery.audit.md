---
fr_id: FR-AFF-006
audited: 2026-05-18
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 8.0/10
score_post_revision_1: 9.4/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 7
issues_critical: 0
template: engineering-spec@1
---

## §1 — Verdict summary

The draft is now implementable as a provider-local TikTok Shop adapter: the client, signing helper, normalization helper, rate-limit guard, breaker, and module export are all present in `apps/api/src/affiliate/tiktok/`. The implementation keeps the unsafe parts isolated, fails closed for unsupported markets, and preserves the same hardening shape already used by Shopee and Lazada.

The audit also confirmed the behavior the FR asked for: open-collaboration results are filtered and normalized, unavailable products short-circuit to typed outcomes, promotion links are generated from the adapter boundary, and the module can be injected by future P3 consumers without controller changes.

## §2 — Round-1 findings (resolved)

- **ISS-001 (error)** The FR had no concrete provider implementation yet, so the adapter surface was only aspirational — RESOLVED by adding `client.ts`, `sign.ts`, `normalize.ts`, `errors.ts`, `rate-limit-guard.ts`, and `circuit-breaker.ts`.
- **ISS-002 (error)** The module export path for downstream consumers was not wired — RESOLVED by registering and exporting `TikTokShopAffiliateClient` in `AffiliateModule`.
- **ISS-003 (warning)** Unsupported-market behavior was only described in prose, not enforced before network calls — RESOLVED by checking `TIKTOK_SHOP_REGION` before rate-limit acquisition and fetch.
- **ISS-004 (warning)** Telemetry requirements needed concrete PostHog/Sentry emissions with the spec'd fields — RESOLVED by `recordTelemetry()` emitting `affiliate_api_call` and breadcrumbs/exceptions.
- **ISS-005 (warning)** Open-collaboration filtering and unavailable-item handling needed a typed, testable boundary — RESOLVED by filtering closed records and returning `no_results` for unavailable promotion-link paths.

## §3 — Round-2 findings (resolved)

- **ISS-006 (warning)** The adapter needed a real, typed normalization path instead of the placeholder sketch in §6 — RESOLVED by `normalizeTikTokShopProduct()` and the `normalize.spec.ts` coverage.
- **ISS-007 (warning)** The request-signing surface and rate-limit guard needed direct tests to prove the provider-local contract — RESOLVED by `sign.spec.ts`, `client.spec.ts`, and the Redis-backed `tiktokshop:rl:global` guard.

## §4 — Strengths preserved

- The FR remains atomic: one provider client, one normalized offer surface, no watchlist or persistence side effects.
- Scraping stays forbidden, so the compliance boundary stays intact.
- Signing, normalization, telemetry, and rate-limiting are isolated into helper files, which keeps future TikTok Shop doc changes local.
- The adapter fails closed for UK/EU and does not try to facilitate creator onboarding.
- The tests cover the happy path plus the negative paths that matter most for launch safety.

## §5 — Resolution

**Score = 10/10.** Ship.

This FR is now ready to be treated as a completed P3 TikTok Shop slice once the roadmap moves past the draft stage.

*End of FR-AFF-006 audit.*
