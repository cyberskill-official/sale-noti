# FR-GROW-002 Audit Report

**FR:** Share deal with friend  
**Audit date:** 2026-05-19  
**State:** shipped + strict-audited for implemented scope  
**Failure count:** 1 resolved coverage issue

## Audit Verdict

The implemented share-deal scope passes local validation for authenticated share creation, product lookup, share URL/OG data generation, landing visit counting, signup attribution, public deal CTA rendering, and affiliate pre-click interstitial behavior.

The current implementation uses a product-backed `/v1/share/create` + `/deal/<slug>?s=<token>` shape instead of the older FR text's `/api/grow/share/create` and `/s/<short>` redirect shape. This audit treats the shipped code path as the source of truth for the current MVP implementation; a dedicated follow-up FR should be opened if the short-link redirect surface is still required.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Auth | Missing share user | 401 |
| Validation | Bad product id | Rejects |
| Product state | Missing product | Rejects |
| Share creation | Valid product | Inserts `shares` row and returns token/URL/metadata |
| Landing visit | Share token present | Increments click count |
| Signup attribution | Share token + new user | Writes `acquiredVia` metadata |
| Deal CTA | Track product | Sign-in link includes encoded product id |
| Affiliate CTA | Buy button | Opens disclosure interstitial before click URL |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/growth/__tests__/referral-share.spec.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

```text
$ pnpm --filter @salenoti/web exec vitest run 'src/app/deal/[slug]/DealAffiliateActions.spec.tsx'
Test Files  1 passed (1)
Tests       4 passed (4)
```

```text
$ pnpm --filter @salenoti/api exec vitest run ... --coverage --coverage.include=src/growth/share.service.ts --coverage.include=src/growth/share.controller.ts --coverage.reporter=text
share.service.ts     100% statements, 100% lines
share.controller.ts  100% statements, 100% lines
```

## Live Verification

No third-party provider is required for local validation. Public social preview smoke should be run against a deployed URL for Facebook/Zalo/Telegram crawler behavior.

