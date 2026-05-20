# FR-AFF-001 Audit Report — Shopee Affiliate Open API Client

**Date:** 2026-05-18 16:45 ICT  
**Initial state:** `Implemented-Pending-Audit`  
**Final state:** `Completed` via deterministic mock/sandbox validation; live Shopee smoke is credential-gated and documented in `docs/qa/FR-AFF-001-live-handoff.md`.

## Audit Findings

The shipped implementation already had typed Shopee methods, SHA256 signing, a circuit breaker, zod schemas, and Redis-backed rate limiting. The first audit failed because the client did not yet prove or implement the FR-required 3 internal retries with exponential jitter backoff for `429`/`5xx`, and there was no client-level mocked unit suite covering telemetry, clock skew, timeout mapping, and per-attempt rate-limit acquisition.

## Fixes Implemented

- Added per-attempt Redis rate-limit acquisition before every Shopee HTTP request.
- Added max 3 internal retries for retryable `429`/`5xx` responses using the shared FR-WORKER-002 `backoffMs` policy.
- Added typed retryability on `ShopeeApiError` without exposing secrets or raw provider payloads.
- Added Sentry breadcrumbs `shopee.api.success` / `shopee.api.failure`.
- Kept PostHog payloads to `{ method, latency_ms, status }`.
- Added mocked client tests for GraphQL POST/signing, retry/backoff, breaker short-circuit, safe telemetry, clock-skew retry, timeout mapping, and rate-limit bucket rollover.
- Updated README, QA traceability, test cases, and live-provider handoff docs.

## Acceptance Criteria Coverage

| AC  | Result                  | Evidence                                                                                 |
| --- | ----------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Mock-passed; live gated | `client.spec.ts`; live env/payload in `docs/qa/FR-AFF-001-live-handoff.md`               |
| 2   | Passed                  | `sign.spec.ts`; header regex and SHA256 reference                                        |
| 3   | Passed                  | Env loaded via `ConfigService`; tests assert no secret/raw payload in telemetry          |
| 4   | Passed                  | `client.spec.ts` proves breaker blocks after 5 failed logical calls                      |
| 5   | Passed                  | `circuit-breaker.spec.ts` proves half-open and close after 3 successes                   |
| 6   | Passed                  | `rate-limit-guard.spec.ts` proves bucket waits into next minute                          |
| 7   | Passed                  | `client.spec.ts` maps timeout to `ShopeeApiError("service_unavailable")`                 |
| 8   | Passed                  | `client.spec.ts` asserts PostHog `shopee_api_call` `{ method, latency_ms, status }`      |
| 9   | Passed                  | `client.spec.ts` asserts analytics excludes product title and raw query                  |
| 10  | Passed                  | `client.spec.ts` proves one retry after `INVALID_TIMESTAMP`                              |
| §1  | Passed                  | API tests cover POST endpoint, typed methods, circuit breaker, rate limit, outcomes, OBS |

## Live Validation Notes

No browser UI or Computer Control flow applies to FR-AFF-001; this FR is a backend Shopee Affiliate API client. UI elements interacted with: none.

External Shopee credentials were not available in the local environment. Per the external dependency protocol, provider behavior was validated with deterministic mocks/sandboxed fetch responses. The exact live smoke payload and manual provider checks are in `docs/qa/FR-AFF-001-live-handoff.md`.

Final verified state: mocked Shopee GraphQL requests sign correctly, retry and record outcomes per attempt, open the breaker after repeated logical failures, preserve safe analytics payloads, and return typed parsed data.

## Raw Terminal Results

### Initial Audit Test Slice Before Fix

```text
$ pnpm --filter @salenoti/api test -- src/affiliate/shopee
Test Files  19 passed | 1 skipped (20)
Tests       62 passed | 3 skipped (65)
```

### Targeted FR-AFF-001 Tests After Fix

```text
$ pnpm --filter @salenoti/api test -- src/affiliate/shopee/__tests__/client.spec.ts src/affiliate/shopee/__tests__/rate-limit-guard.spec.ts src/affiliate/shopee/__tests__/circuit-breaker.spec.ts src/affiliate/shopee/__tests__/sign.spec.ts
Test Files  21 passed | 1 skipped (22)
Tests       68 passed | 3 skipped (71)
```

### API Typecheck

```text
$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit
```

### API Lint

```text
$ pnpm --filter @salenoti/api lint
$ eslint "src/**/*.ts"
```

### API Unit Tests

```text
$ pnpm --filter @salenoti/api test
Test Files  21 passed | 1 skipped (22)
Tests       68 passed | 3 skipped (71)
```

### API E2E Tests

```text
$ pnpm --filter @salenoti/api test:e2e
Test Files  1 passed (1)
Tests       1 passed (1)
```

### API Build

```text
$ pnpm --filter @salenoti/api build
$ nest build
```

### FR Metadata Check

```text
$ pnpm fr:check
$ node scripts/fr-check.mjs
✅ fr-check passed — all FRs conform to feature-request-audit skill §11
```

## Decision

FR-AFF-001 is `Completed` for local/mock validation. Live Shopee provider smoke remains a manual credential-gated follow-up and does not block completion under the mock/sandbox branch of the execution protocol.
