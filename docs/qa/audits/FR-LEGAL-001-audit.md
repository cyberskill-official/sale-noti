# FR-LEGAL-001 Audit Report

**FR:** FR-LEGAL-001 — PDPL DPIA, DPO, A05 breach notification, DSR endpoints, cross-border assessment  
**Audit date:** 2026-05-18  
**Result:** `shipped + mocked-dependency` as of 2026-05-18 21:00 ICT  
**External dependency:** A05/counsel manual filing and receipt. Prepared and contract-tested packet: `docs/legal/A05-submission-packet.md`.

---

## Initial Scan

Existing deliverables were present but incomplete against the FR. Missing or mismatched items found:

- `docs/legal/processor-register.md`
- `docs/legal/retention-schedule.md`
- `docs/legal/breach-response-runbook.md`
- `docs/legal/data-flow-map.png`
- `apps/web/src/server/legal/breach-detector.ts`
- `apps/api/src/legal/__tests__/dsr.spec.ts`
- `/privacy/en` route
- FR-specified `/v1/me/data-export`, `/v1/me/access-request`, `/v1/me/delete-account` routes
- A05 manual submission packet/receipt workflow

Failure count was incremented to `1`.

## Fixes Applied

- Added processor register, retention schedule, breach runbook, A05 submission packet, and data-flow map.
- Added DSR export request queueing with 30-day expected delivery.
- Added DSR access request structured export.
- Added DSR delete-account behavior with immediate tombstone, 24-hour cancellation, and 72-hour hard-purge schedule.
- Added `/v1/me/data-export`, `/v1/me/access-request`, and `/v1/me/delete-account` controller routes.
- Added breach detector helper that computes the 72-hour A05 deadline and pages Slack/email when configured.
- Added `/privacy/en` public English route.
- Added DSR unit tests and expanded public web e2e legal-page coverage.
- Aligned DPO contact with `legal@cyberskill.world` plus `legal@salenoti.vn` alias where appropriate.

## Raw Terminal Evidence

```text
$ node scripts/legal-check.mjs
✅ legal-check passed — disclosure surfaces intact, no commission-rate ranking, manifest scope clean
```

```text
$ vitest run -- src/legal/__tests__/encryption-envelope.spec.ts src/legal/__tests__/dsr.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/legal/__tests__/encryption-envelope.spec.ts (3 tests) 5ms
 ✓ src/legal/__tests__/dsr.spec.ts (4 tests) 3ms

 Test Files  15 passed | 1 skipped (16)
      Tests  54 passed | 3 skipped (57)
```

```text
$ vitest run --config vitest.e2e.config.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/web

 ✓ tests/e2e/public-pages.spec.ts (2 tests) 3602ms
   ✓ public web e2e smoke > renders core public pages with disclosure and policy surfaces 878ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

```text
$ turbo run typecheck

 Tasks:    3 successful, 3 total
 Cached:   1 cached, 3 total
 Time:     2.331s
```

## Live Browser Verification

Browser target: `http://127.0.0.1:3102`

UI/pages interacted with:

- Opened `/privacy`.
  - Final state: title `Chính sách bảo mật — SaleNoti`; visible text included `Chính sách bảo mật`, `DPO`, and `A05`.
- Opened `/privacy/en`.
  - Final state: title `Privacy Policy — SaleNoti`; visible text included `Privacy Policy`, `DPO`, and `A05`.
- Opened `/legal/cross-border-transfer-impact-assessment`.
  - Final state: title `Cross-border Transfer Impact Assessment — SaleNoti`; visible text included `Cross-border`, `A05`, and `MongoDB Atlas`.

## Blocker Payload

Manual A05 submission package is prepared at:

```text
docs/legal/A05-submission-packet.md
```

Receipt must be attached after manual acknowledgement:

```text
docs/legal/A05-receipt-DPIA-2026-05.pdf
```

## Final State

`shipped + mocked-dependency`

Local implementation and validation are complete. The physical A05 acknowledgement is isolated as a mocked dependency and must be replaced with `docs/legal/A05-receipt-DPIA-2026-05.pdf` after DPO/counsel submission.

## Supplemental Zero-Touch Evidence — 2026-05-18 21:00 ICT

Edge-case matrix covered before state update: missing A05 receipt, complete A05 attachment list, DPO appointment conflict declaration, DPIA draft honesty, processor register coverage, cross-border transfer coverage, retention/DSR schedule coverage, DSR export 30-day SLA, DSR access export, soft tombstone, 72-hour purge schedule, PII purge/revocation, encryption envelope associated-data binding, KEK fallback, PII hash salt fallbacks, breach signal paging thresholds, Slack/email unconfigured behavior, and 72-hour A05 deadline generation.

Raw legal/static output:

```text
$ pnpm legal:check
✅ legal-check passed — disclosure surfaces intact, no commission-rate ranking, manifest scope clean
```

Raw API test output:

```text
$ pnpm --filter @salenoti/api test -- src/legal/__tests__/a05-filing-contract.spec.ts src/legal/__tests__/encryption-envelope.spec.ts src/legal/__tests__/dsr.spec.ts

Test Files  25 passed | 1 skipped (26)
Tests       89 passed | 3 skipped (92)
```

Raw API coverage output:

```text
$ pnpm --filter @salenoti/api exec vitest run src/legal/__tests__/a05-filing-contract.spec.ts src/legal/__tests__/encryption-envelope.spec.ts src/legal/__tests__/dsr.spec.ts --coverage --coverage.include=src/legal/dsr-export.service.ts --coverage.include=src/legal/dsr-delete.service.ts --coverage.include=src/legal/encryption-envelope.ts --coverage.reporter=text

File                       % Stmts  % Branch  % Funcs  % Lines
All files                  100      100       100      100
dsr-delete.service.ts      100      100       100      100
dsr-export.service.ts      100      100       100      100
encryption-envelope.ts     100      100       100      100
```

Raw web breach coverage output:

```text
$ pnpm --filter @salenoti/web exec vitest run src/server/legal/__tests__/breach-detector.spec.ts --coverage --coverage.include=src/server/legal/breach-detector.ts --coverage.reporter=text

File                % Stmts  % Branch  % Funcs  % Lines
breach-detector.ts  100      95.65     100      100
```

Raw page/type output:

```text
$ pnpm --filter @salenoti/web test:e2e
Test Files  1 passed (1)
Tests       3 passed (3)

$ pnpm --filter @salenoti/api typecheck
$ pnpm --filter @salenoti/web typecheck
```
