---
id: FR-ADMIN-003
title: "Coupon aggregator — disclosure-first copy-paste coupons, no auto-apply"
module: ADMIN
priority: COULD
status: shipped
verify: T
phase: P3
slice: 3
owner: "Senior Tech Lead + Intern #1 (FE)"
created: 2026-06-01
last_revised: 2026-06-01
related_frs:
  - FR-LEGAL-002
  - FR-ADMIN-002
  - FR-ADMIN-004
  - FR-GROW-003
depends_on:
  - FR-LEGAL-002
  - FR-ADMIN-002
  - FR-ADMIN-004
blocks: []
effort_hours: 6
template: engineering-spec@1
new_files:
  - apps/web/src/server/admin/coupon.service.ts
  - apps/web/src/server/admin/__tests__/coupon.service.spec.ts
  - apps/web/src/app/api/admin/coupons/route.ts
  - apps/web/src/app/api/admin/coupons/__tests__/route.spec.ts
  - apps/web/src/app/dashboard/coupons/page.tsx
  - apps/web/src/lib/auth.ts
modified_files:
  - apps/web/src/app/dashboard/page.tsx
allowed_tools:
  - "file_read/write apps/web/src/app/dashboard/**"
  - "file_read/write apps/web/src/app/api/admin/**"
  - "file_read/write apps/web/src/server/admin/**"
  - "file_read/write apps/web/src/lib/**"
  - "bash pnpm test"
disallowed_tools:
  - "auto-apply coupons or inject promo codes"
  - "override affiliate cookies from other publishers or KOCs"
  - "hide the disclosure block on the coupon page"
risk_if_skipped: "Users who need coupons will keep hunting manually or fall back to shady browser extensions that auto-apply codes. SaleNoti also risks drifting into honey-trap behavior if coupon surfaces are not explicit about copy-paste only, disclosure-first rules."
---

## §1 - Description (BCP-14 normative)

The coupon aggregator SHALL surface copy-paste-only coupon codes in a disclosure-first admin dashboard experience and MUST never auto-apply coupons or mutate affiliate cookies.

1. The system MUST expose `GET /api/admin/coupons?q=<query>&status=active|expired|all&limit=1..50` returning coupon rows from the `coupon_offers` Mongo collection.
2. The system MUST render `/dashboard/coupons` with a visible disclosure block using the canonical affiliate disclosure copy and a banner that states coupons are copy-paste only.
3. The system MUST present coupon title, coupon code, store name, source, expiry, and a clear active/expired badge.
4. The system MUST search by `code`, `title`, `storeName`, or `sourceName` and MUST sort results by priority and recency before display.
5. The system MUST hide records flagged `isPrivate: true` and MUST NOT expose any helper that auto-fills, auto-clicks, or auto-applies a coupon.
6. The system SHOULD allow manual curation of coupon records in Mongo so the page can be maintained without code changes.
7. The system MUST keep the coupon surface under the existing authenticated dashboard and admin API protection; no public coupon endpoint is introduced in this slice.

## §2 - Why this design

Coupon codes are a trust-sensitive surface. If SaleNoti ever starts auto-filling codes or mutating affiliate cookies, the product collapses into the exact honey-trap pattern the legal copy forbids. This slice is intentionally conservative: it makes coupons visible, copyable, and easy to search, while leaving execution entirely to the user.

Placing the surface under `/dashboard/coupons` keeps the implementation aligned with the existing authenticated dashboard patterns and avoids creating a second admin shell before the first one is stable. The admin API route is still useful for future automation and test coverage.

## §3 - API / UI contract

```ts
type CouponStatus = "active" | "expired" | "all";

type CouponOffer = {
  couponId: string;
  title: string;
  code: string;
  storeName: string;
  sourceName: string;
  sourceUrl: string | null;
  summary: string | null;
  status: "active" | "expired";
  expiresAt: string | null;
  priority: number;
  copyOnly: true;
  disclosure: string;
  updatedAt: string;
};

GET /api/admin/coupons?q=...&status=active&limit=24
200 OK
{
  "items": CouponOffer[],
  "total": number,
  "generatedAt": "2026-06-01T00:00:00.000Z"
}
```

## §4 - Acceptance criteria

- `GET /api/admin/coupons` returns only non-private coupons and respects `q`, `status`, and `limit`.
- `/dashboard/coupons` shows the canonical affiliate disclosure and an explicit copy-paste-only notice.
- Expired coupons render with an expired badge and remain visually distinct from active coupons.
- Search matches coupon code, title, store name, and source name.
- The UI never shows an auto-apply control or any cookie override action.

## §5 - Verification

- `apps/web/src/server/admin/__tests__/coupon.service.spec.ts` covers filtering, expiry handling, sorting, and disclosure propagation.
- `apps/web/src/app/api/admin/coupons/__tests__/route.spec.ts` covers auth gating and query parsing.
- `apps/web/src/app/dashboard/coupons/page.tsx` typechecks under the current Next.js 15 app router.
