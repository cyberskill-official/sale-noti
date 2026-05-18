# FR-OBS-001 Audit Report — Observability Baseline

**Audit time:** 2026-05-18 16:00 ICT  
**Manifest result:** `shipped + mocked-dependency`  
**Reason:** local code, contract tests, docs, coverage gates, builds, and health endpoint validation pass; live Sentry/PostHog/Better Stack dashboard setup still requires external credentials and manual provider configuration.

## Local Deliverables

| Requirement | Result | Evidence |
|---|---|---|
| Web Sentry entrypoints | Pass after fix | `apps/web/sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`, `instrumentation.ts` |
| Sentry PII redaction | Pass after fix | `apps/web/src/server/obs/pii-redactor.ts`, unit tests |
| PostHog redaction/no-op wrapper | Pass after fix | `apps/web/src/server/obs/posthog.server.ts`, `apps/api/src/obs/posthog.ts` |
| Health JSON endpoint | Pass after fix | `/api/health` returns status, checks, version, uptime |
| API Sentry/PostHog modules | Pass | Existing `apps/api/src/obs/*` plus redaction hardening |
| Better Stack monitor handoff | Pass local docs | `docs/obs/better-stack-monitors.md` |
| Sentry/PostHog/PII runbooks | Pass local docs | `docs/obs/*.md` |
| Terraform flags | Pass local skeleton | `infra/posthog-flags.tf` |
| Live vendor dashboards | Blocked | Requires DSNs/API keys/provider access |

## 2026-05-18 Supplemental Strict Pass

Additional fixes:

- API Sentry now shares the same email/IP/VN-phone/auth-token redaction semantics as the web boundary.
- API PostHog wrapper now uses the shared redactor and honors `analytics_opt_out`.
- API `/health` now returns the full Better Stack JSON contract: `status`, `checks.mongo`, `checks.redis`, `checks.resend`, `checks.timescale`, `version`, `uptime_seconds`, and `latency_ms`; it also sets HTTP `200`/`503` via passthrough response status.
- API `/health/queue` has BullMQ contract coverage for depth, failed counts, Redis absence, and handle close.
- Web/API URL redactors now scrub serialized URLs after parsing, so emails/phones embedded in URL paths or malformed URL-like text are still removed.

### Edge-Case Matrix

| Vector | Case | Expected result | Evidence |
| --- | --- | --- | --- |
| Missing OBS credentials | No Sentry DSN/PostHog key/Better Stack token | Wrappers no-op locally; provider handoff remains documented | `sentry.spec.ts`, `posthog.spec.ts`, `docs/qa/FR-OBS-001-provider-handoff.md` |
| PII in Sentry event | Email, IP, VN phone, auth cookies, nested token | Redacted before send | API/web `pii-redactor.spec.ts` |
| PII in breadcrumb | POST/PATCH body and sensitive query keys | Body deleted; `token`, `code`, `t`, `secret`, `password` redacted | API/web `pii-redactor.spec.ts` |
| Malformed URL-like text | Free text or permissively parsed URL contains email/phone | Final serialized value is scrubbed | API/web `pii-redactor.spec.ts` |
| Analytics opt-out | `analytics_opt_out: true` | PostHog capture is skipped | `posthog.spec.ts` |
| Provider cache | Multiple captures in one process | One PostHog client is reused, then shutdown flushes | `posthog.spec.ts` |
| Health no env | No Mongo/Redis/Resend/Timescale env | `503 degraded`, all checks false, no client touch | `health.controller.spec.ts`, live curl |
| Health partial outage | One dependency throws | `503 degraded`, failing check false | `health.controller.spec.ts` |
| Health timeout | Dependency hangs beyond budget | Check resolves false within timeout | `health.controller.spec.ts` |
| Queue health no Redis | `REDIS_URL` absent | `{ redis:false, queues:{} }` | `health.controller.spec.ts` |
| Queue count sparsity | BullMQ omits count fields | Depth and failed default to `0` | `health.controller.spec.ts` |

### Supplemental Raw Terminal Evidence

```text
$ pnpm --filter @salenoti/api exec vitest run src/obs/__tests__/pii-redactor.spec.ts src/obs/__tests__/posthog.spec.ts src/obs/__tests__/sentry.spec.ts src/health/__tests__/health.controller.spec.ts --coverage --coverage.include=src/obs/pii-redactor.ts --coverage.include=src/obs/posthog.ts --coverage.include=src/obs/sentry.ts --coverage.include=src/health/health.controller.ts --coverage.reporter=text

 Test Files  4 passed (4)
      Tests  16 passed (16)
All files | 100 | 96.2 | 100 | 100
```

```text
$ pnpm --filter @salenoti/web exec vitest run src/server/obs/__tests__/pii-redactor.spec.ts --coverage --coverage.include=src/server/obs/pii-redactor.ts --coverage.reporter=text

 Test Files  1 passed (1)
      Tests  4 passed (4)
All files | 100 | 91.3 | 100 | 100
```

```text
$ pnpm --filter @salenoti/api test -- src/obs/__tests__/pii-redactor.spec.ts src/obs/__tests__/posthog.spec.ts src/obs/__tests__/sentry.spec.ts src/health/__tests__/health.controller.spec.ts
 Test Files  29 passed | 1 skipped (30)
      Tests  107 passed | 3 skipped (110)

$ pnpm --filter @salenoti/web test -- src/server/obs/__tests__/pii-redactor.spec.ts
 Test Files  11 passed (11)
      Tests  64 passed (64)

$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit

$ pnpm --filter @salenoti/api lint
$ eslint "src/**/*.ts"

$ pnpm --filter @salenoti/web typecheck
$ tsc --noEmit

$ pnpm --filter @salenoti/web lint
$ eslint "src/**/*.{ts,tsx}"

$ pnpm --filter @salenoti/api build
$ nest build

$ pnpm --filter @salenoti/web build
✓ Compiled successfully
✓ Generating static pages (26/26)
```

Live health response without local provider env:

```text
$ curl -i -s http://127.0.0.1:3108/api/health
HTTP/1.1 503 Service Unavailable
content-type: application/json

{"status":"degraded","checks":{"mongo":false,"redis":false,"resend":false,"timescale":false},"version":"local-dev","uptime_seconds":20,"latency_ms":0}
```

## Raw Terminal Evidence

```text
$ pnpm --filter @salenoti/web test
✓ src/server/obs/__tests__/pii-redactor.spec.ts (4 tests) 11ms
Test Files  5 passed (5)
Tests  16 passed (16)

$ pnpm --filter @salenoti/web test:integration
✓ tests/integration/auth.refresh.spec.ts (7 tests) 10ms
✓ tests/integration/auth.magic-link.spec.ts (8 tests) 4ms
✓ tests/integration/auth.google.spec.ts (5 tests) 12ms
Test Files  3 passed (3)
Tests  20 passed (20)

$ pnpm --filter @salenoti/web test:e2e
✓ tests/e2e/public-pages.spec.ts (3 tests) 4639ms
Test Files  1 passed (1)
Tests  3 passed (3)

$ pnpm --filter @salenoti/web typecheck
$ tsc --noEmit

$ pnpm --filter @salenoti/api test
Test Files  15 passed | 1 skipped (16)
Tests  54 passed | 3 skipped (57)

$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit
```

## Live Verification

Dev server:

```text
APP_URL=http://127.0.0.1:3107 API_URL=http://127.0.0.1:4000 AUTH_SECRET=cccc...cccc NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next dev --port 3107 --hostname 127.0.0.1
▲ Next.js 15.0.0
- Local:        http://127.0.0.1:3107
✓ Ready in 700ms
```

Browser-observed state:

```json
{
  "healthUrl": "http://127.0.0.1:3107/api/health",
  "hasStatus": true,
  "hasChecks": true,
  "hasMongo": true,
  "hasRedis": true,
  "hasResend": true,
  "hasTimescale": true
}
```

HTTP health response without local provider env:

```text
$ curl -i -s http://127.0.0.1:3107/api/health
HTTP/1.1 503 Service Unavailable
content-type: application/json

{"status":"degraded","checks":{"mongo":false,"redis":false,"resend":false,"timescale":false},"version":"local-dev","uptime_seconds":17,"latency_ms":0}
```

## External Handoff

Use `docs/qa/FR-OBS-001-provider-handoff.md` to configure live Sentry, PostHog, Better Stack, and Slack evidence before moving this FR to `Completed`.
