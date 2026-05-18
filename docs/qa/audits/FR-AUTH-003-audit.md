# FR-AUTH-003 Audit Report — JWT Session + Refresh Rotation

**Audit time:** 2026-05-18 15:54 ICT  
**Manifest result:** `shipped + strict-audited` as of 2026-05-18 20:55 ICT  
**External dependency posture:** no external API key is required for deterministic validation. MongoDB is mocked in integration tests; live endpoint checks cover unauthenticated/CORS paths without needing a real session store.

## Deliverable Audit

| Requirement | Result | Evidence |
|---|---|---|
| 15-minute HS256 access token with `sub`, `plan`, `familyId`, `jti` | Pass after fix | `apps/web/src/server/auth/session.ts`; unit tests assert claims and TTL |
| `authjs.session-token` and `authjs.refresh-token` HTTP-only cookies | Pass after fix | Cookie constants and integration tests |
| Refresh token hashed in DB, raw only in cookie | Pass | Integration asserts DB lacks raw token |
| Atomic rotate + replay reuse detection | Pass after fix | `findOneAndUpdate` transition; integration concurrent replay test |
| Entire family revoked on reuse | Pass | Integration asserts every family row revoked and Sentry event emitted |
| Refresh rate limiting | Pass | Integration asserts 31st attempt returns `429` + `Retry-After` |
| Sign-out clears cookies and revokes family | Pass after fix | Uses access cookie family; integration asserts revocation |
| Session list redacts IP/UA | Pass after fix | Access-cookie authenticated list returns `ip_hash_prefix` + `ua_summary` |
| Revoke specific session family | Pass after fix | Added `/api/auth/sessions/[familyId]`; integration covers current unaffected |
| Cross-user family revoke returns 404 | Pass after fix | `/api/auth/sessions/[familyId]` now checks `modifiedCount`; integration asserts other-user family is not revoked |
| Extension CORS pinning | Pass after fix | Live and integration verify allowed extension only |
| N-1 `AUTH_SECRET` acceptance | Pass after fix | Unit test covers grace and expired grace |
| PostHog session events | Pass after fix | Added no-op-safe server wrapper and emits created/refreshed/revoked |

## Raw Terminal Evidence

### Unit

```text
$ pnpm --filter @salenoti/web test
$ vitest run

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ src/server/email/__tests__/resend.spec.ts (1 test) 2ms
 ✓ src/components/disclosure/__tests__/disclosure.spec.tsx (4 tests) 1ms
 ✓ src/server/auth/__tests__/session.spec.ts (4 tests) 3ms
 ✓ src/server/auth/__tests__/google-callback-rate-limit.spec.ts (3 tests) 7ms

 Test Files  4 passed (4)
      Tests  12 passed (12)
   Start at  15:54:19
   Duration  254ms (transform 73ms, setup 0ms, collect 121ms, tests 13ms, environment 0ms, prepare 164ms)
```

### Integration

```text
$ pnpm --filter @salenoti/web test:integration
$ vitest run --config vitest.integration.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/integration/auth.refresh.spec.ts (7 tests) 10ms
 ✓ tests/integration/auth.magic-link.spec.ts (8 tests) 5ms
 ✓ tests/integration/auth.google.spec.ts (5 tests) 11ms

 Test Files  3 passed (3)
      Tests  20 passed (20)
   Start at  15:54:19
   Duration  532ms (transform 106ms, setup 0ms, collect 284ms, tests 26ms, environment 0ms, prepare 37ms)
```

### Typecheck

```text
$ pnpm --filter @salenoti/web typecheck
$ tsc --noEmit
```

### End-to-End

```text
$ pnpm --filter @salenoti/web test:e2e
$ vitest run --config vitest.e2e.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/e2e/public-pages.spec.ts (3 tests) 4572ms
   ✓ public web e2e smoke > renders core public pages with disclosure and policy surfaces 897ms
   ✓ public web e2e smoke > redirects dashboard to sign-in and exposes Google sign-in form 821ms
   ✓ public web e2e smoke > rate-limits Google OAuth callback after 10 hits/min/IP 1355ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:54:29
   Duration  4.68s (transform 13ms, setup 0ms, collect 12ms, tests 4.57s, environment 0ms, prepare 24ms)
```

## Live Verification

Dev server:

```text
APP_URL=http://127.0.0.1:3106 API_URL=http://127.0.0.1:4000 AUTH_SECRET=cccc...cccc EXT_ID=abcdefghijklmnopabcdefghijklmnop NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next dev --port 3106 --hostname 127.0.0.1
▲ Next.js 15.0.0
- Local:        http://127.0.0.1:3106
✓ Ready in 742ms
```

Browser interactions:

- Opened `http://127.0.0.1:3106/api/auth/sessions`.
- Final state: JSON route visible and contained `no_session` for unauthenticated user.
- Opened `http://127.0.0.1:3106/privacy`.
- Final state: privacy page showed `authjs.session-token` and `authjs.refresh-token`.

Browser-observed state:

```json
{
  "sessionsUrl": "http://127.0.0.1:3106/api/auth/sessions",
  "sessionsHasNoSession": true,
  "privacyHasAuthSessionCookie": true,
  "privacyHasAuthRefreshCookie": true
}
```

Live endpoint checks:

```text
$ curl -i -s -X POST http://127.0.0.1:3106/api/auth/refresh
HTTP/1.1 401 Unauthorized
content-type: application/json

{"ok":false,"code":"no_token"}

$ curl -i -s -X OPTIONS http://127.0.0.1:3106/api/auth/refresh -H 'Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop' -H 'Access-Control-Request-Method: POST'
HTTP/1.1 204 No Content
access-control-allow-credentials: true
access-control-allow-headers: Content-Type
access-control-allow-methods: POST
access-control-allow-origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop
access-control-max-age: 600

$ curl -i -s -X OPTIONS http://127.0.0.1:3106/api/auth/refresh -H 'Origin: chrome-extension://malicious' -H 'Access-Control-Request-Method: POST'
HTTP/1.1 204 No Content
<no Access-Control-Allow-Origin header>
```

## Supplemental Zero-Touch Evidence — 2026-05-18 20:55 ICT

Edge-case matrix covered before implementation: missing refresh cookie, expired refresh token, revoked session, reused refresh token, concurrent refresh attempts, transaction retry success, exhausted transaction retry, compare-and-set race, raw token body leakage, hash-only DB storage, sign-out with access cookie, sign-out with refresh cookie only, cross-user family revoke, missing session list cookie, extension CORS allowed/blocked origins, common and unknown UA summaries, missing explicit hash salts, and N-1 `AUTH_SECRET` acceptance.

Raw integration output:

```text
$ pnpm --filter @salenoti/web test:integration

✓ tests/integration/auth.refresh.spec.ts (12 tests)
✓ tests/integration/auth.magic-link.spec.ts (13 tests)
✓ tests/integration/auth.google.spec.ts (5 tests)

Test Files  3 passed (3)
Tests       30 passed (30)
```

Raw coverage output:

```text
$ pnpm --filter @salenoti/web exec vitest run tests/integration/auth.refresh.spec.ts --config vitest.integration.config.ts --coverage --coverage.include=src/server/auth/refresh.ts '--coverage.include=src/app/api/auth/sessions/[familyId]/route.ts' --coverage.reporter=text

File        % Stmts  % Branch  % Funcs  % Lines
refresh.ts 100      91.66     100      100
```

Raw e2e/type output:

```text
$ pnpm --filter @salenoti/web typecheck
$ pnpm --filter @salenoti/web test:e2e

Test Files  1 passed (1)
Tests       3 passed (3)
```

Live endpoint verification:

```text
$ curl -i -s -X POST http://127.0.0.1:3106/api/auth/refresh
HTTP/1.1 401 Unauthorized
{"ok":false,"code":"no_token"}

$ curl -i -s -X OPTIONS http://127.0.0.1:3106/api/auth/refresh -H 'Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop' -H 'Access-Control-Request-Method: POST'
HTTP/1.1 204 No Content
access-control-allow-origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop

$ curl -i -s -X OPTIONS http://127.0.0.1:3106/api/auth/refresh -H 'Origin: chrome-extension://malicious' -H 'Access-Control-Request-Method: POST'
HTTP/1.1 204 No Content
<no Access-Control-Allow-Origin header>

$ curl -i -s http://127.0.0.1:3106/api/auth/sessions
HTTP/1.1 401 Unauthorized
{"ok":false,"error":"no_session"}
```
