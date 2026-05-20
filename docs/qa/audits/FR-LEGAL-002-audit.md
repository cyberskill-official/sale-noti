# FR-LEGAL-002 Audit Report

**FR:** Affiliate disclosure surfaces  
**Audit date:** 2026-05-18  
**State:** shipped + strict-audited  
**Failure count:** 3 resolved validation failures (historical partial audit, JSX test render mismatch, TS test overload)

## Audit Verdict

Initial audit failed because the implementation was partial: the canonical copy existed, but several enforceable deliverables were missing or duplicated.

Fixed deliverables:

- Added shared `@salenoti/disclosure-copy` package so web and API alert emails use the same source text.
- Added `OnboardingDisclosureStep` and made sign-in disclosure-first.
- Added `POST /api/auth/disclosure-ack` and hashed consent records.
- New sign-ins now store both `privacy_v1` and `affiliate_disclosure_v1`.
- Extension onboarding now attempts durable disclosure ack, and unacknowledged Shopee pages show a degraded onboarding prompt.
- Added `no-commission-ranking` and `disclosure-import-required` ESLint rules.
- Added required docs: disclosure copy, ethics principles, transparency report template.
- Hardened `scripts/legal-check.mjs` to verify canonical imports, legal docs, rules, manifest scope, and no hardcoded app disclosure drift.
- Supplemental strict audit added a deal-page client CTA gate so `Mua ngay trên Shopee` opens the pre-click interstitial path instead of bypassing it as a direct affiliate anchor.

## Edge-Case Matrix

| Vector | Case | Expected result | Evidence |
| --- | --- | --- | --- |
| Null / anonymous consent | `/api/auth/disclosure-ack` without access cookie | `401 no_session`, no DB write | `route.spec.ts` |
| Malformed consent payload | Unknown consent kind or invalid JSON | Unknown kind returns `400`; invalid JSON defaults to affiliate disclosure v1 | `route.spec.ts` |
| Consent storage privacy | IP and user-agent are present | Only salted 24-char hashes are stored | `disclosure-consent.spec.ts` |
| Consent replacement | User re-acknowledges same kind | Prior consent kind is pulled before latest version is pushed | `disclosure-consent.spec.ts` |
| Browser storage outage | Anonymous onboarding has no durable session | Local ack persists; POST failure is caught | `disclosure.spec.tsx` |
| Extreme / encoded product id | Product id contains spaces or `/` | Sign-in tracking URL encodes product id | `DealAffiliateActions.spec.tsx` |
| Malformed affiliate URL | Interstitial receives invalid URL | Hostname falls back to `unknown`; click is still user-confirmed | `disclosure.spec.tsx` |
| Repeat click race | Pre-click cookie already exists | Hook opens target immediately with `noopener,noreferrer` | `disclosure.spec.tsx` |
| First click | No pre-click cookie | Hook queues pending click and renders modal before navigation | `disclosure.spec.tsx` |
| Extension degraded mode | No local disclosure ack | Content script shows onboarding-required panel and avoids tracking UI | `extension/tests/manifest.spec.ts` |

## 2026-05-18 Supplemental Raw Terminal Results

```text
$ pnpm --filter @salenoti/web test -- src/components/disclosure/__tests__/disclosure.spec.tsx src/server/legal/__tests__/disclosure-consent.spec.ts src/app/api/auth/disclosure-ack/route.spec.ts 'src/app/deal/[slug]/DealAffiliateActions.spec.tsx'

 Test Files  11 passed (11)
      Tests  64 passed (64)
```

```text
$ pnpm --filter @salenoti/web exec vitest run src/components/disclosure/__tests__/disclosure.spec.tsx src/server/legal/__tests__/disclosure-consent.spec.ts src/app/api/auth/disclosure-ack/route.spec.ts 'src/app/deal/[slug]/DealAffiliateActions.spec.tsx' --coverage --coverage.include=src/components/disclosure/AffiliateDisclosureCard.tsx --coverage.include=src/components/disclosure/OnboardingDisclosureStep.tsx --coverage.include=src/components/disclosure/PreClickInterstitial.tsx --coverage.include=src/lib/disclosure.ts --coverage.include=src/server/legal/disclosure-consent.ts --coverage.include=src/app/api/auth/disclosure-ack/route.ts '--coverage.include=src/app/deal/**/DealAffiliateActions.tsx' --coverage.reporter=text

 Test Files  4 passed (4)
      Tests  39 passed (39)

All files          |   98.29 |    97.95 |   96.87 |   98.29
DealAffiliateActions.tsx | 100 | 100 | 100 | 100
OnboardingDisclosureStep.tsx | 100 | 100 | 100 | 100
PreClickInterstitial.tsx | 93.81 | 100 | 90 | 93.81
```

```text
$ pnpm legal:check
✅ legal-check passed — disclosure surfaces intact, no commission-rate ranking, manifest scope clean

$ pnpm --filter @salenoti/web typecheck
$ tsc --noEmit

$ pnpm --filter @salenoti/web lint
$ eslint "src/**/*.{ts,tsx}"

$ pnpm --filter @salenoti/web test:e2e
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ pnpm --filter @salenoti/extension test
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ pnpm --filter @salenoti/extension typecheck
$ tsc --noEmit

$ pnpm --filter @salenoti/web build
✓ Compiled successfully
✓ Generating static pages (26/26)
```

## 2026-05-18 Browser Verification

Local server: `http://localhost:3107`

- `/legal/affiliate`: rendered canonical Vietnamese disclosure, all 5 ethics principles, the ARPU revenue model, and the Transparency link. The only console error was the existing missing `favicon.ico` 404.
- `/auth/sign-in`: initial state rendered `Đăng nhập SaleNoti`, `Trước khi bắt đầu`, canonical disclosure, all 5 principles, unchecked `Tôi đã hiểu và đồng ý`, and disabled `Tiếp tục`.
- `/auth/sign-in` after checkbox + continue: rendered `Sign in with Google`, magic-link email input, and `Gửi magic link`. The unauthenticated `POST /api/auth/disclosure-ack` returned the expected `401 no_session`; local onboarding acknowledgement still advanced.
- `/transparency`: rendered the quarterly cadence, first-report due `2026-Q3`, required report fields, and the report template link. `/transparency/2026-q3` intentionally 404s until the first post-quarter report exists.

## Raw Terminal Results

```text
$ pnpm legal:check
$ node scripts/legal-check.mjs
✅ legal-check passed — disclosure surfaces intact, no commission-rate ranking, manifest scope clean
```

```text
$ pnpm --filter @salenoti/web test
$ vitest run

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ src/server/obs/__tests__/pii-redactor.spec.ts (4 tests) 5ms
 ✓ src/components/disclosure/__tests__/disclosure.spec.tsx (4 tests) 2ms
 ✓ src/server/email/__tests__/resend.spec.ts (1 test) 1ms
 ✓ src/server/auth/__tests__/google-callback-rate-limit.spec.ts (3 tests) 4ms
 ✓ src/server/auth/__tests__/session.spec.ts (4 tests) 3ms
 ✓ src/server/legal/__tests__/disclosure-consent.spec.ts (2 tests) 4ms

 Test Files  6 passed (6)
      Tests  18 passed (18)
```

```text
$ pnpm --filter @salenoti/web test:integration
$ vitest run --config vitest.integration.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/integration/auth.refresh.spec.ts (7 tests) 9ms
 ✓ tests/integration/auth.magic-link.spec.ts (8 tests) 5ms
 ✓ tests/integration/auth.google.spec.ts (5 tests) 11ms

 Test Files  3 passed (3)
      Tests  20 passed (20)
```

```text
$ pnpm --filter @salenoti/web test:e2e
$ vitest run --config vitest.e2e.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/e2e/public-pages.spec.ts (3 tests) 5312ms
   ✓ public web e2e smoke > renders core public pages with disclosure and policy surfaces 841ms
   ✓ public web e2e smoke > redirects dashboard to sign-in and exposes Google sign-in form 1563ms
   ✓ public web e2e smoke > rate-limits Google OAuth callback after 10 hits/min/IP 1330ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

```text
$ pnpm --filter @salenoti/api test
$ vitest run

 Test Files  19 passed | 1 skipped (20)
      Tests  62 passed | 3 skipped (65)
```

```text
$ pnpm --filter @salenoti/api test:e2e
$ vitest run --config vitest.e2e.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/admin/__tests__/b2b-lead.e2e-spec.ts (1 test) 134ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

```text
$ pnpm --filter @salenoti/extension test
$ vitest run --passWithNoTests

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/extension

 ✓ tests/manifest.spec.ts (3 tests) 2ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

```text
$ pnpm --filter @salenoti/web typecheck && pnpm --filter @salenoti/web lint && pnpm --filter @salenoti/web build
$ tsc --noEmit
$ eslint "src/**/*.{ts,tsx}"
$ next build
✓ Compiled successfully
✓ Generating static pages (26/26)
```

```text
$ pnpm --filter @salenoti/api typecheck && pnpm --filter @salenoti/api lint && pnpm --filter @salenoti/api build
$ tsc --noEmit
$ eslint "src/**/*.ts"
$ nest build
```

```text
$ pnpm --filter @salenoti/extension typecheck && pnpm --filter @salenoti/extension lint && pnpm --filter @salenoti/extension test && pnpm --filter @salenoti/extension build
$ tsc --noEmit
$ eslint "src/**/*.ts"
$ vitest run --passWithNoTests
✓ tests/manifest.spec.ts (3 tests) 2ms
$ node esbuild.config.mjs
extension: built dist/
```

```text
$ pnpm fr:check
$ node scripts/fr-check.mjs
✅ fr-check passed — all FRs conform to feature-request-audit skill §11
```

## Live UI Verification

Local server: `http://127.0.0.1:3108`

Interactions:

- Opened `/auth/sign-in`.
- Confirmed initial state displayed `Đăng nhập SaleNoti`, `Trước khi bắt đầu`, canonical Vi disclosure, all 5 principles, checkbox `Tôi đã hiểu và đồng ý`, and disabled `Tiếp tục`.
- Clicked checkbox `Tôi đã hiểu và đồng ý`.
- Clicked button `Tiếp tục`.
- Confirmed final state displayed `Sign in with Google`, `Hoặc nhận link đăng nhập qua email`, and `Gửi magic link`.
- Opened `/legal/affiliate`.
- Confirmed page contains canonical disclosure, `Minh bạch`, `ARPU =`, and `Transparency`.

No social posting is involved in this FR.
