# FR-AUTH-001 Audit Report — Google OAuth via Auth.js v5

**Audit time:** 2026-05-18 15:36 ICT  
**Manifest result:** `shipped + mocked-dependency` as of 2026-05-18 20:41 ICT  
**Reason:** local implementation, contract tests, coverage, e2e route checks, and browser verification pass. Real Google OAuth consent/callback and p95 timing still require a Google Cloud OAuth client and manual test account consent, so the external provider is isolated behind contract tests and sandbox credentials.

## Deliverable Audit

| Requirement | Result | Evidence |
|---|---|---|
| Exact `next-auth@5.0.0-beta.25` pin | Pass | `apps/web/package.json` exact dependency check passed |
| Auth.js v5 Google provider | Pass | `apps/web/src/auth.ts` exports Auth.js handlers and Google provider |
| Least-privilege scope | Pass | `authorization.params.scope = "openid email profile"` |
| Route `GET/POST /api/auth/[...nextauth]` | Pass | `apps/web/src/app/api/auth/[...nextauth]/route.ts` |
| User upsert on sign-in | Pass | `apps/web/src/server/users/upsert-on-signin.ts`, integration test |
| Fail-closed invalid/missing user data | Pass | Integration tests cover missing/unverified email |
| `iss` and `aud` validation | Pass | `apps/web/src/auth.ts` callback checks issuer/audience |
| Callback rate limit 10/min/IP | Pass after fix | Added `apps/web/src/server/auth/google-callback-rate-limit.ts`, wrapped route POST, e2e validates 11th hit returns 429 |
| Web env template | Pass after fix | Added `apps/web/.env.example` |
| Google OIDC provider contract | Pass after fix | `apps/web/src/server/auth/__tests__/google-sign-in.spec.ts` asserts issuer, audience, profile fields, redirect policy, and telemetry |
| Auth telemetry | Pass after fix | `auth.google.sign_in.{started,succeeded,failed}` breadcrumbs + `auth_sign_in` PostHog events |
| Live Google consent round-trip | Mocked dependency | Requires Google OAuth client ID/secret and manual consent; sandbox browser reaches Google `invalid_client` boundary |

## Code/Test Changes Made During Audit

- Added callback rate-limit helper and wired it before the Auth.js POST handler.
- Moved the no-Redis rate-limit fallback to `globalThis` so Next dev/server route reloads preserve counters.
- Converted auth integration tests from credential-gated MongoDB to an in-memory Mongo-compatible collection.
- Added HTTP e2e coverage for `POST /api/auth/callback/google` returning `429` on the 11th request.
- Added `apps/web/.env.example`.
- Added external handoff packet at `docs/qa/FR-AUTH-001-google-oauth-handoff.md`.
- Updated root `README.md` environment setup notes.
- Rewired the visible Google sign-in button from a plain `/api/auth/signin/google` GET form to the Auth.js v5 server-action `signIn("google")` path after live testing found Auth.js rejected the plain GET as `UnknownAction`.

## Raw Terminal Evidence

### Unit

```text
$ pnpm --filter @salenoti/web test -- src/server/auth/__tests__/google-callback-rate-limit.spec.ts
$ vitest run -- src/server/auth/__tests__/google-callback-rate-limit.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ src/server/auth/__tests__/session.spec.ts (3 tests) 2ms
 ✓ src/components/disclosure/__tests__/disclosure.spec.tsx (4 tests) 2ms
 ✓ src/server/auth/__tests__/google-callback-rate-limit.spec.ts (3 tests) 7ms

 Test Files  3 passed (3)
      Tests  10 passed (10)
   Start at  15:37:27
   Duration  261ms (transform 78ms, setup 0ms, collect 120ms, tests 12ms, environment 0ms, prepare 123ms)
```

### Integration

```text
$ pnpm --filter @salenoti/web test:integration
$ vitest run --config vitest.integration.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/integration/auth.google.spec.ts (5 tests) 13ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  15:37:27
   Duration  405ms (transform 40ms, setup 0ms, collect 195ms, tests 13ms, environment 0ms, prepare 44ms)
```

### End-to-End

```text
$ pnpm --filter @salenoti/web test:e2e
$ vitest run --config vitest.e2e.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/e2e/public-pages.spec.ts (3 tests) 5711ms
   ✓ public web e2e smoke > renders core public pages with disclosure and policy surfaces 831ms
   ✓ public web e2e smoke > redirects dashboard to sign-in and exposes Google sign-in form 1877ms
   ✓ public web e2e smoke > rate-limits Google OAuth callback after 10 hits/min/IP 1405ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:37:27
   Duration  5.86s (transform 18ms, setup 0ms, collect 16ms, tests 5.71s, environment 0ms, prepare 32ms)
```

### Typecheck

```text
$ pnpm --filter @salenoti/web typecheck
$ tsc --noEmit
```

### Package Pin

```text
$ node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('apps/web/package.json','utf8'));if(p.dependencies['next-auth']!=='5.0.0-beta.25'){console.error('next-auth pin violated:',p.dependencies['next-auth']);process.exit(1)}console.log('next-auth pin OK:',p.dependencies['next-auth'])"
next-auth pin OK: 5.0.0-beta.25
```

### Committed Secret Assignment Check

```text
$ rg -n "(GOOGLE_CLIENT_SECRET|AUTH_SECRET)=" apps/web --glob '!.env.example'
<no matches>
```

## Live Browser Verification

Dev server:

```text
APP_URL=http://127.0.0.1:3104 API_URL=http://127.0.0.1:4000 AUTH_SECRET=dddd...dddd GOOGLE_CLIENT_ID=test-google-client GOOGLE_CLIENT_SECRET=test-google-secret NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next dev --port 3104 --hostname 127.0.0.1
▲ Next.js 15.0.0
- Local:        http://127.0.0.1:3104
✓ Ready in 730ms
```

UI interactions:

- Opened `http://127.0.0.1:3104/auth/sign-in`.
- Verified one visible button named `Sign in with Google`.
- Opened `http://127.0.0.1:3104/dashboard`.
- Final state: redirected to `http://localhost:3104/auth/sign-in?callbackUrl=%2Fdashboard`, sign-in page visible.
- Returned to `/auth/sign-in` and clicked `Sign in with Google`.
- Final state with sandbox credentials: Google OAuth page at `https://accounts.google.com/signin/oauth/error?...client_id=test-google-client...`, with `invalid_client`, confirming the corrected Auth.js sign-in path reaches Google and real OAuth credentials are required for consent completion.

Browser-observed state:

```json
{
  "signInTitle": "SaleNoti — Theo dõi giá Shopee",
  "googleButtonCount": 1,
  "signInHasPolicy": true,
  "dashboardRedirectUrl": "http://localhost:3104/auth/sign-in?callbackUrl=%2Fdashboard",
  "dashboardHasSignIn": true,
  "postClickUrl": "https://accounts.google.com/signin/oauth/error?...client_id=test-google-client...",
  "postClickTitle": "accounts.google.com/signin/oauth/error?...client_id=test-google-client..."
}
```

## Blocker Packet

The exact external payload is documented in `docs/qa/FR-AUTH-001-google-oauth-handoff.md`. Move this FR to `Completed` only after a real Google OAuth client is configured and a live consent test reaches `/dashboard`.

## Supplemental Zero-Touch Evidence — 2026-05-18 20:41 ICT

Edge-case matrix covered before implementation: missing/empty env, non-Google provider, invalid `iss`, invalid `aud`, null Google profile fields, missing/unverified email, Mongo upsert failure, open redirect, repeated callback rate-limit, and missing real Google credentials.

Raw focused unit output:

```text
$ pnpm --filter @salenoti/web test -- src/auth.spec.ts src/server/auth/__tests__/google-sign-in.spec.ts src/server/auth/__tests__/google-callback-rate-limit.spec.ts

Test Files  8 passed (8)
Tests       28 passed (28)
```

Raw coverage output:

```text
$ pnpm --filter @salenoti/web exec vitest run src/auth.spec.ts src/server/auth/__tests__/google-sign-in.spec.ts --coverage --coverage.include=src/auth.ts --coverage.include=src/server/auth/google-sign-in.ts --coverage.reporter=text

File                         % Stmts  % Branch  % Funcs  % Lines
All files                    100      100       100      100
src/auth.ts                  100      100       100      100
src/server/auth/google-sign-in.ts 100 100       100      100
```

Raw integration/e2e/type output:

```text
$ pnpm --filter @salenoti/web typecheck
$ pnpm --filter @salenoti/web test:integration
Test Files  3 passed (3)
Tests       20 passed (20)

$ pnpm --filter @salenoti/web test:e2e
Test Files  1 passed (1)
Tests       3 passed (3)
```

Browser verification final states:

- `/auth/sign-in` initially shows the disclosure gate with disabled `Tiếp tục`.
- After checking `Tôi đã hiểu và đồng ý`, the page shows `Sign in with Google` and the magic-link form.
- Clicking `Sign in with Google` with sandbox credentials reaches Google's OAuth error page with `Error 401: invalid_client`, proving the app reaches the provider boundary and real credentials are the only remaining live dependency.
