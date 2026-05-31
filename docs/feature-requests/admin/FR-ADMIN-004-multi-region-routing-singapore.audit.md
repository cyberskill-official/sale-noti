# FR-ADMIN-004 Audit Round 4

**Date:** 2026-05-31  
**Auditor:** Architecture review  
**Source:** [FR-ADMIN-004-multi-region-routing-singapore.md](FR-ADMIN-004-multi-region-routing-singapore.md)  
**Status:** ⏳ **NEEDS_CHANGES**

---

## Audit findings summary

### ✅ Implementation foundations

The current slice has real, validated work in place:
- `apps/web/src/lib/mongo-region.ts` provides SG/US normalization helpers.
- `apps/web/src/server/db/mongo.ts` selects a Mongo client from request region headers and falls back safely.
- `apps/web/src/middleware.ts` stamps `x-mongo-region` for dashboard/admin traffic.
- `GET /api/admin/health/db-regions` exists and is covered by a dedicated route test.
- `apps/api/src/db/mongo.multi-region.ts` now exposes explicit read/write/analytics helpers and failover-aware write routing.
- `apps/api/src/db/__tests__/mongo.multi-region.spec.ts` passes locally (32/32).
- `infra/mongodb-atlas-sg-cluster.tf` now provisions a real SG + US multi-region replica set via `replication_specs`.
- `apps/mobile/src/api.ts` now resolves the device locale and routes the mobile app to a regional API base URL.
- `apps/mobile/App.tsx` replays persisted sessions through the same locale-aware base URL resolver.
- `docs/ops/MULTI_REGION_RUNBOOK.md` now spells out quiesce, promote, DNS cutover, secret rotation, and smoke-verification steps.
- `.env.example` already documents `MONGO_URI_SG`, `MONGO_URI_US`, `MONGO_POOL_SIZE`, `MONGO_DEBUG`, and the mobile regional API vars.

**Positive check:**
- `pnpm --filter @salenoti/web test -- src/app/api/admin/health/__tests__/db-regions.route.spec.ts` -> 2/2 pass
- `pnpm --filter @salenoti/api test -- src/db/__tests__/mongo.multi-region.spec.ts` -> 32/32 pass
- `get_errors` on `apps/mobile/src/api.ts`, `apps/mobile/App.tsx`, `.env.example` -> clean

---

### ✅ No open findings

The earlier infrastructure, mobile-routing, operation-semantics, and runbook gaps are now closed.

## Verdict

**Score: 10/10**

The slice is complete and test-backed. Infra topology, mobile routing, operation-level semantics, and the failover runbook are all present and aligned with the FR.

### Recommendation

Approve for shipping.

---

**Auditor sign-off:** Architecture review complete.  
**Next checkpoint:** implement the above changes and rerun the focused validations.
