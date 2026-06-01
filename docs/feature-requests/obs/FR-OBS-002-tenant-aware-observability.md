---
id: FR-OBS-002
title: "Tenant-aware observability — 10% public tail-sampling, 100% B2B coverage, Grafana-ready tenant labels"
module: OBS
priority: MUST
status: done
shipped: 2026-06-01
verify: T
phase: P3
milestone: P3 · roadmap observability slice
slice: 1
owner: Senior Tech Lead
created: 2026-06-01
last_revised: 2026-06-01
related_frs: [FR-OBS-001, FR-ADMIN-002]
depends_on: [FR-OBS-001, FR-ADMIN-002]
blocks: []
effort_hours: 4
template: engineering-spec@1
new_files:
  - apps/web/src/server/obs/tenant.ts
  - apps/web/src/server/obs/__tests__/tenant.spec.ts
  - apps/web/src/server/obs/__tests__/sentry.server.spec.ts
modified_files:
  - apps/web/src/server/obs/sentry.server.ts
  - apps/web/src/middleware.ts
  - apps/web/src/app/dashboard/page.tsx
  - apps/web/src/app/dashboard/coupons/page.tsx
  - apps/web/src/app/api/admin/products/search/route.ts
  - apps/web/src/app/api/admin/products/[productId]/history/route.ts
  - apps/web/src/app/api/admin/products/[productId]/analytics/route.ts
  - docs/feature-requests/BACKLOG.md
  - docs/qa/TASK_MANIFEST.md
  - docs/obs/sentry-projects.md
allowed_tools: ["file_read/write apps/web/**", "file_read/write docs/**", "bash pnpm test"]
disallowed_tools:
  - "lower B2B traces below 100%"
  - "emit raw seller identifiers outside tenant-labeled observability tags"
  - "introduce a Grafana dependency without tenant labels"
risk_if_skipped: "B2B dashboard/API traffic stays mixed with generic consumer traces, making Grafana filters noisy and losing the ability to isolate seller-specific incidents."

---

## §1 — Description (BCP-14 normative)

This slice SHALL preserve the existing 10% public tracing baseline while forcing 100% sampling for tenant-scoped B2B dashboard/admin traffic. It also SHALL stamp tenant labels at the request boundary so downstream dashboards and future Grafana scoping can filter by seller context without guessing from raw URLs.

1. The system MUST sample public traffic at 10% and B2B dashboard/admin traffic at 100%.
2. The sampler MUST resolve the scope from `x-observability-scope` when present, then fall back to the request path or transaction name.
3. The middleware MUST stamp `x-observability-scope=b2b` on `/dashboard/**` and `/api/admin/**` requests.
4. The dashboard pages and B2B API handlers MUST tag the active Sentry scope with `tenant_scope`, `tenant_id`, `tenant_subscription_id`, and `tenant_tier` when available.
5. The tagging contract MUST stay tenant-aware without emitting raw seller data into public telemetry channels.

## §2 — Why this design

Tail-sampling only works if the sampler can tell which requests belong to paying tenants. The route header gives the sampler a cheap, stable signal; the Sentry tags give downstream tools a stable label set for filtering. That keeps the implementation small while leaving room for a real Grafana deployment later.

## §3 — Validation

- `pnpm --filter @salenoti/web test -- src/server/obs/__tests__/tenant.spec.ts src/server/obs/__tests__/sentry.server.spec.ts`
- `get_errors` on the touched web slice
