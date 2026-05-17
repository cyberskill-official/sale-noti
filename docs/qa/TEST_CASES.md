# SaleNoti Test Cases

**Version:** 1.0  
**Date:** 2026-05-18  
**Scope:** P0-P2 shipped FRs

---

## 1. Automated Test Inventory

| ID | Type | Target | File/command | Expected result |
|---|---|---|---|---|
| TC-AUTO-001 | Static | FR manifest/frontmatter/audits | `pnpm fr:check` | All shipped FRs have valid metadata and audit pairs |
| TC-AUTO-002 | Static | Legal/disclosure gates | `pnpm legal:check` | Disclosure constant, store listing copy, and ethics checks pass |
| TC-AUTO-003 | Static | TypeScript | `pnpm typecheck` | Web, API, extension compile with strict checks |
| TC-AUTO-004 | Static | ESLint | `pnpm lint` | No lint errors |
| TC-AUTO-005 | Unit | API/web/extension | `pnpm test` | All unit tests pass; Timescale-only tests skip without URL |
| TC-AUTO-006 | E2E | API/web/extension | `pnpm test:e2e` | Public web smoke, B2B API e2e, and extension manifest e2e pass |
| TC-AUTO-007 | Build | Production bundles | `pnpm build` | Next.js, NestJS, and extension production artifacts build |

## 2. Per-FR Test Cases

| FR | Test case | Type | Steps | Expected result | Current automation |
|---|---|---|---|---|---|
| FR-AUTH-001 | Google OAuth provider config | Integration | Load Auth.js config and sign-in page; inspect Google endpoint | Auth.js v5 beta pin and Google flow are wired | `apps/web/tests/integration/auth.google.spec.ts`, e2e sign-in smoke |
| FR-AUTH-002 | Magic link issue/consume | Unit/manual provider | Submit email to issue route; consume token once; retry consume | Valid token creates session; second use fails; token TTL 15 min | Covered by route/service implementation; add provider smoke with Resend credentials |
| FR-AUTH-003 | JWT access and refresh cookies | Unit/e2e | Sign access token; verify TTL; tamper token; inspect cookie flags | 15-min access, tamper rejected, HTTP-only secure-ish cookies | `apps/web/src/server/auth/__tests__/session.spec.ts` |
| FR-LEGAL-001 | PDPL artifacts and DSR endpoints | Static/manual | Inspect legal docs; call DSR export/delete in staging | DPIA/DPO/A05/cross-border docs exist; DSR paths available | `pnpm legal:check`, docs review |
| FR-LEGAL-002 | Disclosure surfaces | Static/unit/browser | Render disclosure components and public legal page | Canonical disclosure appears; pre-click interstitial path exists | `apps/web/src/components/disclosure/__tests__/disclosure.spec.tsx`, `pnpm legal:check` |
| FR-OBS-001 | Observability baseline | Manual/staging | Trigger test error/event/uptime check | Sentry captures, PostHog event redacted, Better Stack alert configured | SRS checklist; staging credentials required |
| FR-WORKER-001 | BullMQ queues and Redis TLS | Unit/manual | Parse `rediss://`; inspect queues; open Bull Board with auth | Queues exist, TLS enabled, Bull Board protected | `apps/api/src/queue/__tests__/queues.spec.ts` |
| FR-WORKER-002 | Adaptive scheduler buckets | Unit/manual | Evaluate hot/mid/low products and API health throttling | 30m/6h/24h cadence and error backoff apply | `apps/api/src/scheduler/__tests__/priority-engine.spec.ts`, `backoff.spec.ts` |
| FR-AFF-001 | Shopee signed client | Unit/provider | Sign request; simulate breaker failures; run live GraphQL smoke | SHA256 signature valid; breaker opens/closes; no secret logging | `sign.spec.ts`, `circuit-breaker.spec.ts`; live provider blocked by credentials |
| FR-AFF-002 | Deeplink attribution | Unit/provider | Generate deeplink with user/watchlist/source/campaign; retry same call | subIds present; cache/idempotency works; disclosure route controls click | `apps/api/src/affiliate/__tests__/deeplink.spec.ts` |
| FR-AFF-003 | Product/shop offer resolver | Integration/provider | Resolve product and shop offer, write Mongo and Timescale rows | Product metadata and price observation persist; errors captured | Requires Shopee and DB credentials; Timescale integration test covers DB layer |
| FR-AFF-004 | Product search cache/sanitize | Unit/provider | Search keyword; repeat; include HTML in mocked name | Cache hit flagged; HTML/script stripped; limits enforced | `apps/api/src/affiliate/__tests__/product-search.spec.ts` |
| FR-WATCH-001 | Track Shopee URL | Unit/API/manual | POST Shopee URL; inspect product and watchlist rows | Product resolved and watchlist created/upserted | `url-parser.spec.ts`; provider-backed staging smoke needed |
| FR-WATCH-002 | Alert trigger config | Unit/API | PATCH triggers; evaluate trigger context | Valid triggers accepted; cooldown respected; invalid config rejected | `trigger-eval.spec.ts` |
| FR-WATCH-003 | List/pause/delete/cap | API/manual | Create 10 free watchlists; try 11th; pause/resume/delete | Free cap enforced; status updates; delete is soft | Staging API smoke needed |
| FR-PRICE-001 | Timescale hypertable | Integration | Run migrations against Timescale; insert price rows; query aggregate | Hypertable and continuous aggregate are idempotent | `apps/api/src/db/__tests__/timescale.spec.ts` when `TIMESCALE_DB_URL` exists |
| FR-PRICE-002 | History API | API/manual | GET history for 30d/90d; request invalid range/product | Chart-ready buckets; capped ranges; auth/public rules apply | Staging API smoke needed |
| FR-NOTIF-001 | Email alert dispatch | Unit/provider | Render alert email; dispatch with idempotency; simulate webhook | Disclosure included; duplicate suppressed; webhook mutates delivery state | Processor implementation; Resend staging smoke required |
| FR-NOTIF-002 | Web push | Browser/provider | Subscribe in Chrome, dispatch alert, click notification, revoke permission | Subscription saved; alert delivered; click tracked; expired endpoint cleaned | Browser/staging push smoke required |
| FR-EXT-001 | Chrome MV3 extension | Unit/manual Chrome | Inspect manifest; load unpacked extension; open Shopee product page | MV3, no `<all_urls>`, button appears after product URL, disclosure ack required | `extension/tests/manifest.spec.ts`; manual Chrome load |
| FR-BILL-001 | Billing subscribe/webhooks | Unit/provider | Start Stripe checkout; inspect metadata; run webhook; test dev fallback | Redirect URL generated; metadata present; webhook-only lifecycle | `apps/api/src/billing/__tests__/billing.service.spec.ts`; Stripe/VNPay/MoMo smoke needed |
| FR-NOTIF-003 | Telegram bot | Provider/manual | Generate link token; `/start`; dispatch alert; duplicate same idem key | Chat linked; message sent with inline button; duplicate suppressed | Telegram staging smoke required |
| FR-GROW-001 | Referral anti-fraud | Unit/API | Create qualified invites; test same IP/email-root/device abuse | Three qualified invites unlock reward; suspicious cases flagged | `apps/api/src/growth/__tests__/fraud-detect.spec.ts` |
| FR-GROW-002 | Share deal page | Web/API/browser | Create share link; open `/deal/:slug`; click CTA | OG metadata, disclosure, click attribution, fallback if affiliate fails | Public page e2e smoke covers route class; API staging smoke needed |
| FR-GROW-003 | Mega Sale Mode | Web/API/browser/manual social | Open sale page; inspect active/upcoming API; review manual social calendar | Event page renders; hot-tier schedule is bounded; manual posts prepared | Browser smoke and `docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md` |
| FR-ADMIN-001 | B2B lead capture | Unit/e2e/browser | Submit lead with consent; submit without consent; inspect stored row | Consent required; PII encrypted/hash-only; Slack/PostHog redacted | `b2b-lead.service.spec.ts`, `b2b-lead.e2e-spec.ts`, browser smoke |

## 3. Negative Test Cases

| ID | Area | Steps | Expected result |
|---|---|---|---|
| TC-NEG-001 | Auth | Tamper JWT payload/signature | `verifyAccessToken` returns null |
| TC-NEG-002 | Magic link | Reuse consumed token | Request rejected and no new session created |
| TC-NEG-003 | B2B lead | Submit without PDPL consent | 400 validation error |
| TC-NEG-004 | B2B lead PII | Search stored JSON for raw email/phone | Raw values absent |
| TC-NEG-005 | Extension | Add `<all_urls>` to manifest | Manifest test fails |
| TC-NEG-006 | Affiliate ethics | Rank consumer search by commission | Legal check should fail when rule exists; code review blocks |
| TC-NEG-007 | Product search | Product name includes `<script>` | Returned text is stripped |
| TC-NEG-008 | Queue | Redis URL uses `rediss://` | TLS config enabled |
| TC-NEG-009 | Billing | Client redirect claims payment success without webhook | Subscription state must not activate |
| TC-NEG-010 | Telegram | Webhook secret missing/wrong | Handler rejects mutation |
| TC-NEG-011 | Commission reconcile | Provider event references no known short URL/subIds | Event is written to unmatched collection and not silently dropped |

## 4. Browser Test Cases

| ID | Page/flow | Steps | Expected result |
|---|---|---|---|
| TC-BR-001 | Landing | Open `http://127.0.0.1:3000/` | Hero/content render and disclosure/legal links exist |
| TC-BR-002 | Sign-in | Open `/auth/sign-in` | Google sign-in and email form visible |
| TC-BR-003 | Dashboard redirect | Open `/dashboard` while anonymous | Redirect to `/auth/sign-in` |
| TC-BR-004 | Business lead form | Open `/business`; submit required fields with consent | Local success if API route configured; validation if missing consent |
| TC-BR-005 | Privacy | Open `/privacy` | Policy text renders |
| TC-BR-006 | Affiliate legal | Open `/legal/affiliate` | Disclosure and revenue model render |
| TC-BR-007 | Mega Sale | Open `/megasale/2026-11-11` | Event page renders, no overlapping UI; no local DB degrades to collecting-deals fallback |
| TC-BR-008 | Share deal | Open representative `/deal/:slug` | Product/deal CTA and disclosure render |

## 5. Provider Test Cases

| ID | Provider | Preconditions | Steps | Expected result |
|---|---|---|---|---|
| TC-PROV-001 | Shopee | Affiliate app id/secret | Run productOfferV2 query | Valid response mapped and no secret in logs |
| TC-PROV-002 | Shopee | Affiliate credentials | Generate short link | Shopee short URL returned with subIds |
| TC-PROV-003 | Resend | Verified domain/API key | Send magic link and alert email | Email delivered; disclosure present |
| TC-PROV-004 | Telegram | Bot token/webhook secret | Set webhook, send `/start <token>` | Chat linked |
| TC-PROV-005 | Web Push | VAPID keys + Chrome | Subscribe and dispatch alert | Notification displayed |
| TC-PROV-006 | Stripe | Test key/webhook secret | Checkout and webhook replay | Subscription active only after signed webhook |
| TC-PROV-007 | VNPay | Test merchant | Create payment URL and return callback | Signature valid and state updated |
| TC-PROV-008 | MoMo | Test merchant | Create payment URL and IPN | Signature valid and state updated |
| TC-PROV-009 | Sentry/PostHog | DSNs/keys | Trigger test error/event | Redacted event visible in dashboards |
| TC-PROV-010 | Better Stack | Monitor token | Hit health endpoints and force downtime | Alert fires |

## 6. Release Sign-Off Template

```text
Release candidate:
Commit:
Environment:

Static:
- fr:check:
- legal:check:
- typecheck:
- lint:

Automated:
- unit:
- e2e:
- build:
- integration:

Browser smoke:
- landing:
- sign-in:
- dashboard redirect:
- business:
- privacy/legal:
- mega sale/share:

Provider smoke:
- Shopee:
- Resend:
- Web Push:
- Telegram:
- Stripe:
- VNPay:
- MoMo:
- Observability:

Known blockers:
Decision:
Approver:
```
