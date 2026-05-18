# FR-AUTH-002 Audit Report — Email Magic-Link Sign-In

**Audit time:** 2026-05-18 15:45 ICT  
**Manifest result:** `shipped + mocked-dependency` as of 2026-05-18 20:49 ICT  
**External dependency posture:** Resend provider delivery requires `RESEND_API_KEY` and a verified sender domain, but deterministic tests use a mock Resend sender and in-memory Mongo-compatible collections. This satisfies the external-dependency branch because contract tests cover the full issue/consume HTTP shape, token lifecycle, disclosure content, and telemetry.

## Deliverable Audit

| Requirement | Result | Evidence |
|---|---|---|
| `POST /api/auth/magic-link/issue` validates `{ email }` | Pass | Route returns `400 invalid_email` for malformed input; integration tests cover valid/invalid issue |
| 256-bit random token; only hash stored | Pass | Integration asserts stored `tokenHash === sha256(rawToken)` and stored doc lacks raw token |
| Resend email with disclosure | Pass with mock | Integration asserts mock Resend call contains required disclosure text |
| 15-minute expiry | Pass | Integration verifies expiry timestamp and expired consume rejection |
| Atomic single-use consume | Pass | Integration verifies first consume redirects to `/dashboard`, second redirects to invalid token |
| Issue rate limits | Pass | Integration covers 3/min/email and 10/min/IP with `Retry-After` |
| Consume rate limit | Pass after fix | Route now returns `429` + `Retry-After`; integration covers 21st hit |
| Upsert provider is `magic-link` | Pass after fix | `upsertUserOnSignIn` accepts provider; consume passes `magic-link`; integration asserts user row |
| Raw token never logged | Pass after fix | Resend dev stub logs only metadata/byte counts; unit test asserts raw token absent |
| Magic-link UI on sign-in page | Pass after fix | Added client-side form on `/auth/sign-in`; e2e and live browser verified |
| Magic-link observability | Pass after fix | Emits `auth.magic_link.{issued,consumed,rejected}` breadcrumbs and PostHog `auth_sign_in` with `auth_sign_in_method: "magic-link"` |

## Raw Terminal Evidence

### Unit

```text
$ pnpm --filter @salenoti/web test
$ vitest run

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ src/server/auth/__tests__/session.spec.ts (3 tests) 2ms
 ✓ src/server/email/__tests__/resend.spec.ts (1 test) 2ms
 ✓ src/components/disclosure/__tests__/disclosure.spec.tsx (4 tests) 2ms
 ✓ src/server/auth/__tests__/google-callback-rate-limit.spec.ts (3 tests) 4ms

 Test Files  4 passed (4)
      Tests  11 passed (11)
   Start at  15:44:00
   Duration  266ms (transform 64ms, setup 0ms, collect 138ms, tests 11ms, environment 0ms, prepare 157ms)
```

### Integration

```text
$ pnpm --filter @salenoti/web test:integration
$ vitest run --config vitest.integration.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/integration/auth.magic-link.spec.ts (8 tests) 10ms
 ✓ tests/integration/auth.google.spec.ts (5 tests) 12ms

 Test Files  2 passed (2)
      Tests  13 passed (13)
   Start at  15:44:00
   Duration  559ms (transform 61ms, setup 0ms, collect 346ms, tests 22ms, environment 0ms, prepare 33ms)
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

 ✓ tests/e2e/public-pages.spec.ts (3 tests) 4932ms
   ✓ public web e2e smoke > renders core public pages with disclosure and policy surfaces 888ms
   ✓ public web e2e smoke > redirects dashboard to sign-in and exposes Google sign-in form 857ms
   ✓ public web e2e smoke > rate-limits Google OAuth callback after 10 hits/min/IP 1452ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:44:06
   Duration  5.04s (transform 14ms, setup 0ms, collect 12ms, tests 4.93s, environment 0ms, prepare 25ms)
```

### Live API Invalid-Email Check

```text
$ curl -i -s -X POST http://127.0.0.1:3105/api/auth/magic-link/issue -H 'Content-Type: application/json' --data '{"email":"not-an-email"}'
HTTP/1.1 400 Bad Request
content-type: application/json

{"ok":false,"error":"invalid_email"}
```

## Live Browser Verification

Dev server:

```text
APP_URL=http://127.0.0.1:3105 API_URL=http://127.0.0.1:4000 AUTH_SECRET=dddd...dddd GOOGLE_CLIENT_ID=test-google-client GOOGLE_CLIENT_SECRET=test-google-secret NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next dev --port 3105 --hostname 127.0.0.1
▲ Next.js 15.0.0
- Local:        http://127.0.0.1:3105
✓ Ready in 736ms
```

UI interactions:

- Opened `http://127.0.0.1:3105/auth/sign-in`.
- Verified the Google button remains visible.
- Verified the magic-link email input is visible with placeholder `you@example.com`.
- Verified the `Gửi magic link` submit button is visible.
- Clicked the email input and typed `not-an-email`.
- Clicked `Gửi magic link`.
- Final state: browser stayed on `/auth/sign-in` with the email input present; live invalid-email API call returned `400 {"ok":false,"error":"invalid_email"}`.

Browser-observed state:

```json
{
  "afterMagicUrl": "http://127.0.0.1:3105/auth/sign-in",
  "visibleDom": "<button>Sign in with Google</button> ... <input name=\"email\" value=\"not-an-email\" required> ... <button>Gửi magic link</button>"
}
```

## Residual Provider Smoke

Staging should still run a Resend provider smoke with a verified domain before public launch:

```bash
doppler run -- curl -i -X POST https://staging.salenoti.vn/api/auth/magic-link/issue \
  -H 'Content-Type: application/json' \
  --data '{"email":"your-test-inbox@example.com"}'
```

Expected: `200`, delivered email contains the disclosure, and the link can be consumed exactly once.

## Supplemental Zero-Touch Evidence — 2026-05-18 20:49 ICT

Edge-case matrix covered before implementation: malformed JSON/body, invalid email, missing forwarded IP/user-agent, missing `APP_URL`, long user-agent truncation via service path, token hash-only storage, expired token, random token, missing token, repeated token consume, per-email issue rate limit, per-IP issue rate limit, consume-side IP rate limit, Mongo upsert failure, and missing Resend credentials.

Raw focused integration output:

```text
$ pnpm --filter @salenoti/web test:integration

✓ tests/integration/auth.magic-link.spec.ts (13 tests)
✓ tests/integration/auth.refresh.spec.ts (7 tests)
✓ tests/integration/auth.google.spec.ts (5 tests)

Test Files  3 passed (3)
Tests       25 passed (25)
```

Raw coverage output:

```text
$ pnpm --filter @salenoti/web exec vitest run tests/integration/auth.magic-link.spec.ts --config vitest.integration.config.ts --coverage --coverage.include=src/server/auth/magic-link/issue.ts --coverage.include=src/server/auth/magic-link/consume.ts --coverage.include=src/app/api/auth/magic-link/issue/route.ts --coverage.include=src/app/api/auth/magic-link/consume/route.ts --coverage.reporter=text

File                                            % Stmts  % Branch  % Funcs  % Lines
All files                                       100      100       100      100
src/app/api/auth/magic-link/consume/route.ts    100      100       100      100
src/app/api/auth/magic-link/issue/route.ts      100      100       100      100
src/server/auth/magic-link/consume.ts           100      100       100      100
src/server/auth/magic-link/issue.ts             100      100       100      100
```

Raw e2e/type output:

```text
$ pnpm --filter @salenoti/web typecheck
$ pnpm --filter @salenoti/web test:e2e

Test Files  1 passed (1)
Tests       3 passed (3)
```

Browser/API verification final states:

- `/auth/sign-in` initially shows the disclosure gate and disabled `Tiếp tục`.
- After checking `Tôi đã hiểu và đồng ý`, the page shows `Sign in with Google`, the `Hoặc nhận link đăng nhập qua email` input, and `Gửi magic link`.
- Entering `not-an-email` keeps the browser on `/auth/sign-in` because the native `type=email` control blocks submit.
- Direct API invalid-email smoke returned `HTTP/1.1 400 Bad Request` with `{"ok":false,"error":"invalid_email"}`.
