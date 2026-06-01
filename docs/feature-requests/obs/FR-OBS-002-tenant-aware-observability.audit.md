---
fr_id: FR-OBS-002
audited: 2026-06-01
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 9.0/10
score_post_revision_1: 10/10
issues_open: 0
issues_resolved: 0
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-06-01
final_revision: 2026-06-01
---

## §1 — Verdict summary

FR-OBS-002 is complete: public traffic stays at the 10% baseline, B2B dashboard/admin traffic is forced to 100% sample, and the active Sentry scope is labeled with tenant metadata so downstream Grafana scoping can filter by seller context.

## §2 — Implementation evidence

- `apps/web/src/server/obs/tenant.ts` resolves public vs B2B scope, derives the sampler rate, and exposes tenant tag helpers.
- `apps/web/src/server/obs/sentry.server.ts` uses a `tracesSampler` callback instead of a flat `tracesSampleRate`.
- `apps/web/src/middleware.ts` stamps `x-observability-scope` for B2B requests.
- `apps/web/src/app/dashboard/page.tsx`, `apps/web/src/app/dashboard/coupons/page.tsx`, and the three B2B API routes tag the active scope with tenant labels.

## §3 — Validation evidence

- `pnpm --filter @salenoti/web test -- src/server/obs/__tests__/tenant.spec.ts src/server/obs/__tests__/sentry.server.spec.ts` → 7/7 pass.
- `get_errors` on the touched web observability slice → clean.
