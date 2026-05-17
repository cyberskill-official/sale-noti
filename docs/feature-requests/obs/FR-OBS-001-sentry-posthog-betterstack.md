---
id: FR-OBS-001
title: "Observability baseline — Sentry (errors + traces) + PostHog (analytics + flags) + Better Stack (uptime + logs + heartbeats) · PII redaction · daily metrics digest"
module: OBS
priority: MUST
status: shipped
shipped: 2026-05-17
verify: T
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-LEGAL-001, FR-WORKER-001, FR-WORKER-002, FR-AUTH-001, FR-AUTH-003, FR-NOTIF-001, FR-BILL-001]
depends_on: []
blocks: [FR-LEGAL-001, FR-AUTH-001, FR-WORKER-001, FR-WORKER-002, FR-NOTIF-001]
effort_hours: 8
template: engineering-spec@1

new_files:
  - apps/web/src/server/obs/sentry.ts
  - apps/web/src/server/obs/posthog.ts
  - apps/web/src/server/obs/slack.ts
  - apps/web/src/server/obs/correlation.ts
  - apps/web/src/server/obs/pii-redactor.ts
  - apps/web/instrumentation.ts
  - apps/web/sentry.server.config.ts
  - apps/web/sentry.edge.config.ts
  - apps/web/sentry.client.config.ts
  - apps/web/src/app/api/health/route.ts
  - apps/api/src/main.ts
  - apps/api/src/obs/sentry.module.ts
  - apps/api/src/obs/posthog.module.ts
  - apps/api/src/obs/correlation.middleware.ts
  - apps/api/src/health/health.controller.ts
  - docs/obs/sentry-projects.md
  - docs/obs/posthog-event-taxonomy.md
  - docs/obs/runbook-pii-leak.md
  - apps/web/src/server/obs/__tests__/pii-redactor.spec.ts
modified_files:
  - apps/web/next.config.mjs
  - apps/web/package.json
  - apps/api/src/app.module.ts
allowed_tools: ["file_read/write apps/web/**", "file_read/write apps/api/**", "bash pnpm install", "bash pnpm test"]
disallowed_tools:
  - "send PII to PostHog without first redacting (Email/Phone/IP MUST hash before send)"
  - "set Sentry sample rate < 0.1 in prod (under-sampling defeats incident triage)"
  - "configure Better Stack to ping with credentials in URL (token leak in monitor history)"
  - "log full request bodies via Sentry breadcrumbs (PII leak surface)"
  - "use distinctId other than the sha256+salt 16-char prefix (cross-tool joinability + PII risk)"
  - "ship without the /api/health endpoint — Better Stack monitor depends on JSON body assertion"
risk_if_skipped: "Plan §C10 explicit: 'Trưởng nhóm chưa nhắc đến observability. Bắt buộc thêm.' Without OBS, FR-LEGAL-001 breach-detector can't page; plan §I metrics (D7, CTR, alerts_sent) can't be measured; plan §H free-tier overruns aren't detected; incident response is blind. Every downstream FR's Sentry tag + PostHog event depends on this foundation."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The platform MUST instrument all runtime components with three OBS pillars and provide a unified observability surface.

### Sentry (errors + performance + profiling)

1. The system MUST install Sentry SDK v8.x in both `apps/web` (`@sentry/nextjs`) and `apps/api` (`@sentry/nestjs` + `@sentry/node`). DSNs MUST be read from Doppler envs `SENTRY_DSN_WEB` and `SENTRY_DSN_API` respectively. Two separate Sentry projects MUST be created to keep error volumes attributable.
2. Sentry init configuration MUST set:
   - `tracesSampleRate: 0.1` (10% of transactions; configurable via `SENTRY_TRACES_SAMPLE_RATE`)
   - `profilesSampleRate: 0.05` (subset of traces)
   - Errors at `1.0` (always captured)
   - `environment: process.env.NODE_ENV`
   - `release: process.env.GIT_COMMIT` (set by Vercel/Railway build)
   - `ignoreErrors: ["AbortError", "NEXT_NOT_FOUND", "ResizeObserver loop limit exceeded"]`
3. Sentry MUST use Next.js 15 `instrumentation.ts` pattern; the file MUST `await import("./sentry.server.config")` under `nodejs` runtime and `./sentry.edge.config` under `edge` runtime. Client-side Sentry MUST init via `sentry.client.config.ts`.
4. Sentry MUST capture (without manual instrumentation): unhandled exceptions, HTTP 5xx responses from API routes, Mongo client errors, BullMQ job failures (FR-WORKER-001), Resend SDK errors, Stripe webhook signature failures, ALL `Sentry.captureException()` and `captureMessage()` calls.
5. Sentry's `beforeSend` hook MUST redact PII per `apps/web/src/server/obs/pii-redactor.ts` BEFORE the event leaves the SDK:
   - `event.user.email` → `[redacted]`
   - `event.request.cookies.authjs.refresh-token` → `[redacted]`
   - `event.request.cookies.authjs.session-token` → `[redacted]`
   - Any tag/extra/context value matching `/[\w.+-]+@[\w-]+\.[\w.-]+/` (email regex) → `[redacted-email]`
   - Any tag/extra/context value matching `/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/` (IPv4) → `[redacted-ip]`
   - Any tag/extra/context value matching `/\b\+?84[0-9]{9}\b/` (VN phone) → `[redacted-phone]`
6. Sentry breadcrumbs MUST NOT include full request bodies for POST/PUT/PATCH. Breadcrumb URL paths MAY be retained; query strings MUST be stripped of `token`, `code`, `t`, `secret`, `password` keys.
7. Sentry events MUST be tagged with the originating FR ID via `Sentry.setTag("fr", "FR-XXX-NNN")` at the boundary of each service module. This enables grep-style filtering in incident triage.

### PostHog (analytics + feature flags)

8. The system MUST install PostHog SDK in both web (`posthog-js` client + `posthog-node` server) with project keys from Doppler (`POSTHOG_KEY`, `POSTHOG_HOST`). The `POSTHOG_HOST` MUST be `https://us.i.posthog.com` (US-hosted PostHog Cloud).
9. The event taxonomy MUST be defined in `docs/obs/posthog-event-taxonomy.md`. Core events (each with REQUIRED + OPTIONAL property sets):
   - `auth_sign_in` { distinctId, method: "google"|"magic_link", source }
   - `auth_session_refreshed` { family_age_days }
   - `product_tracked` { shopId, itemId, productId, source, hasNickname, triggerCount }
   - `alert_sent` { channel, trigger, latency_ms }
   - `alert_clicked` { channel, trigger, ttc_seconds }
   - `affiliate_link_clicked` { source, productId, position }
   - `commission_confirmed` { amount_vnd_bucket, network }
   - `extension_installed` { version }
   - `pre_click_interstitial_continued` { destination_host }
   - `subscription_started` { plan, gateway, interval, amountVnd }
   - `subscription_cancelled` { reason, tenure_days }
   - `dsr_requested` { kind: "export"|"delete"|"access" }
   - `breach_signal` { kind } (never raw context)
10. PostHog `distinctId` for authenticated users MUST be `sha256(userEmail.toLowerCase() + POSTHOG_PII_SALT).slice(0, 16)`. Anonymous users use `posthog-js` auto-generated UUID. Raw `userEmail` MUST NEVER reach PostHog payload.
11. PostHog property values MUST be redacted before send via the same `pii-redactor.ts` patterns as Sentry §1 #5. The redactor MUST run inside the `posthog.capture()` wrapper.
12. PostHog Feature Flags MUST be created via Terraform (`infra/posthog-flags.tf`) so flag state is versioned alongside code. Initial flags:
    - `freemium_pricing_v1` (default `false`, rollout 0% at launch).
    - `pro_tier_visible` (default `false`).
    - `mega_sale_mode_2026_11_11` (default `false`, scheduled 2026-11-04 enablement).
    - `bullmq_adaptive_scheduler_v2` (engineering canary).
13. The system MUST emit `bootstrap` to PostHog on every server-rendered page load via Next.js Server Components, so initial flag state is available without a client round-trip.
14. PostHog event sampling MUST be `1.0` for `auth_*`, `subscription_*`, `dsr_*`, `breach_signal`, `alert_sent`, `alert_clicked`. Other high-volume events (`product_tracked`, `affiliate_link_clicked`) MAY be sampled at `0.5` if monthly cap approached.

### Better Stack (uptime + logs + heartbeats)

15. Better Stack monitors MUST be configured for:
    - `https://sale.cyber.skill` (HTTP 200, 60s interval)
    - `https://sale.cyber.skill/api/health` (JSON `{ status: "ok" }`, 30s)
    - `https://api.sale.cyber.skill/health` (30s)
    - MongoDB Atlas SG cluster (TCP probe, 60s, via Atlas Activity Feed webhook if available)
    - Redis Upstash REST endpoint (60s)
    - Resend domain status (5min)
    Alert MUST fire to Slack `#oncall` + email after 3 consecutive failures (~90s).
16. Better Stack heartbeats MUST be configured for BullMQ crons (FR-WORKER-002):
    - `cron-price-check-tier1-30m` (expects ping every 30 min ± 5 min)
    - `cron-price-check-tier2-6h` (6h ± 30 min)
    - `cron-price-check-tier3-24h` (24h ± 2h)
    - `cron-megasale-teaser` (daily at 09:00 ICT ± 30 min)
    - `cron-grace-period-worker` (every 6h ± 30 min)
    - `cron-retention-purge` (every 6h ± 30 min)
17. Better Stack Logs (formerly Logtail) MUST ingest stdout/stderr from Vercel functions and Railway containers via the official drainer integrations. Log retention 14 days at MVP; structured JSON logs with `correlationId` field for cross-tool join.

### Health endpoint

18. The system MUST expose `GET /api/health` (web app) AND `GET /health` (api service) returning JSON `{ status: "ok" | "degraded", checks: { mongo: bool, redis: bool, resend: bool, timescale: bool }, version, uptime_seconds }`. Each sub-check MUST timeout at 1 second; overall response MUST be < 1500ms. HTTP 200 if all checks pass; 503 if any fail. The endpoint MUST be unauthenticated.

### Slack alerts

19. Sentry alert rules MUST be configured to fire to Slack `#oncall`:
    - "P1 — any unhandled exception" → `level: error` events, immediate.
    - "P1 — security event" → `tags.kind ∈ {reuse_detected, auth_breach, breach_signal}`, immediate.
    - "P2 — frequency spike" → > 50 events of same `fingerprint` in 1h, batched daily.
20. Better Stack alerts MUST route the same channel; Pagination → daily digest at 08:00 ICT.

### Daily metrics digest

21. The system MUST publish a daily PostHog Insights summary to Slack `#daily-metrics` at 09:00 ICT (FR-WORKER-002 cron). Required content:
    - DAU + WoW % change
    - New signups (24h)
    - Products tracked (cumulative + 24h delta)
    - Alerts sent + delivered (24h) by channel
    - Alert CTR + ratio vs target (25%)
    - Estimated affiliate revenue (24h)
    - D7 retention cohort (rolling)
    - Free-tier-cap conversion (% of users hit 10-watchlist limit who upgrade)
22. The digest MUST be Markdown-formatted Slack mrkdwn; metrics MUST cite the underlying PostHog Insight ID for drill-down.

### Quotas + budgets

23. Free-tier budgets MUST be tracked:
    - Sentry: 5K errors/month (hard cap); alert at 4K.
    - PostHog: 1M events/month; alert at 800K (80%) and 950K (95%).
    - Better Stack: 5 monitors free (we're using 6 — first paid tier $24/mo); 1 heartbeat free per monitor.
24. PII-opt-out: users with `users.privacySettings.analytics_opt_out: true` MUST trigger `posthog.opt_out_capturing()` client-side AND `posthog.capture()` server-side MUST no-op for that user. This MUST be honored on signup if the user unchecked the analytics-consent.

### Correlation + tracing

25. Every API request MUST be tagged with a `correlationId` (ULID) at the edge (Vercel/middleware), propagated via `X-Correlation-Id` header to NestJS, included in Sentry's transaction context, and emitted in PostHog property `correlationId`. This enables a single ID to bridge an error in Sentry → an event in PostHog → a log line in Better Stack.
26. BullMQ jobs MUST inherit the originating request's `correlationId` (passed in job data). Worker errors MUST tag Sentry with the inherited `correlationId`.

### Compliance + retention

27. Sentry retention MUST be 30 days (default); PostHog 12 months; Better Stack logs 14 days. PII purge via Sentry data-purge API MUST be triggered on DSR delete (FR-LEGAL-001 §1 #10 cron). PostHog records use hashed `distinctId`, technically non-identifiable post-hash; no separate purge.
28. The system MUST publish `docs/obs/runbook-pii-leak.md` describing the response when PII is found in any OBS tool: containment (stop the leak source), purge (use vendor purge APIs), notify (DPO + counsel), filings (A05 if material per FR-LEGAL-001 §1 #6).

---

## §2 — Why this design

**Why three separate pillars (not Datadog / New Relic / single APM):** plan §C10 explicit. Each free-tier covers MVP volume comfortably (Sentry 5K, PostHog 1M, Better Stack 6 monitors/heartbeats). Datadog at "$31/host/mo for APM + $0.10/log/GB" eats founder runway fast; New Relic similar. Consolidated APM is deferred to P3 when revenue justifies the OpEx.

**Why PostHog (not Mixpanel, Amplitude):** plan §C10 prefers PostHog because of (a) free feature-flag UI built-in (Mixpanel/Amplitude charge for this), (b) open-source self-host escape hatch if PostHog Cloud ever turns adversarial, (c) reasonable export model. Mixpanel is more polished UX but no flags; Amplitude has 10M events free but the flag tier is paid.

**Why hash emails before PostHog ingestion:** PostHog Cloud is US-hosted. PDPL Decree 13 Art. 25 treats raw emails as personal data subject to cross-border transfer requirements. Hashing pushes PostHog data beyond "personal data" classification, simplifying our compliance posture AND making the cross-border-transfer impact assessment (FR-LEGAL-001 §1 #19) more defensible.

**Why two separate Sentry projects (web vs api):** error volumes from web (browser) and api (server) have different patterns. Browser errors include client-side noise (ad-block, browser-extension conflicts, "ResizeObserver" non-issues); API errors are mostly server-side and more actionable. Keeping them separate allows distinct alert rules + distinct sample rates + cleaner triage.

**Why `instrumentation.ts` pattern (not `_app.tsx`):** Next.js 15 App Router requires this. SSR + RSC trace propagation works ONLY via the `register` hook in `instrumentation.ts`. The old `_app.tsx` Sentry pattern was deprecated in v13.

**Why `correlationId` propagation across all three pillars:** when an incident occurs, you need to trace it: "user clicked X → caused error Y → resulted in PostHog event Z → log line in Better Stack W". Without a shared ID, you're chasing timestamps across 3 tools — multiplied by clock skew and timezone confusion. A ULID generated at the edge and propagated forward solves this with one ID.

**Why daily metrics digest in Slack:** founder accountability. Plan §I sets specific weekly/monthly targets (DAU 250, CTR 25%, D7 25%); if numbers aren't visible daily, drift goes uncaught for weeks. Slack is where founders already are; pushing the daily summary there embeds the metrics into the working day. The PostHog Insight ID citations make every metric drill-downable.

**Why redact at SDK boundary (beforeSend) not at vendor:** redacting at the SDK means PII NEVER leaves our process. Redacting at the vendor relies on their internal data handling, which we can't audit. PDPL compliance favors the strict pattern.

**Why 0.1 traces sample rate:** Sentry trace ingestion is expensive (full request-flow span trees). 10% is the standard recommendation for B2C apps at MVP scale — captures enough patterns for performance analysis without burning the quota. We can crank to 1.0 for short windows during incident investigation.

**Why `1.0` errors (never sample):** errors are by definition rare and high-signal. Sampling errors is the classic "we couldn't reproduce" trap. Errors always at 100%.

**Why Better Stack heartbeats for BullMQ crons (not Sentry's own scheduled monitoring):** Sentry's cron monitoring is paid-tier only. Better Stack heartbeats are free per monitor. Two-tool pattern keeps cost low; the heartbeat is just a periodic `GET https://uptime.betterstack.com/api/v1/heartbeat/<id>` that the cron task hits.

**Why expose `/api/health` as JSON-bodied (not just 200):** Better Stack monitors can assert on response body content (`status: "ok"`), which catches the case where the server returns 200 but a sub-dependency (Mongo) is dead. Pure HTTP-status monitoring would miss this.

**Why version-control Feature Flags in Terraform:** flags change cluster behavior at scale. A flipped flag without audit trail is the classic "what changed at 2pm last Tuesday?" debugging trap. Terraform `posthog_feature_flag` resources put the flag state in git, alongside code that consumes them.

---

## §3 — Code shape

```ts
// apps/web/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// apps/web/sentry.server.config.ts
import * as Sentry from "@sentry/nextjs";
import { redactPII } from "./src/server/obs/pii-redactor";

Sentry.init({
  dsn: process.env.SENTRY_DSN_WEB!,
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
  profilesSampleRate: 0.05,
  environment: process.env.NODE_ENV,
  release: process.env.GIT_COMMIT,
  ignoreErrors: ["AbortError", "NEXT_NOT_FOUND", "ResizeObserver loop limit exceeded"],
  beforeSend(event) {
    return redactPII(event);
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === "fetch" && breadcrumb.data?.url) {
      breadcrumb.data.url = breadcrumb.data.url.replace(/([?&])(token|code|t|secret|password)=[^&]+/gi, "$1$2=[redacted]");
    }
    if (["POST", "PUT", "PATCH"].includes(breadcrumb.data?.method ?? "")) {
      delete breadcrumb.data?.body;
    }
    return breadcrumb;
  },
});

// apps/web/src/server/obs/pii-redactor.ts
import type { Event } from "@sentry/types";

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const IP_RE = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
const VN_PHONE_RE = /\b\+?84[0-9]{9}\b/g;

export function redactPII(event: Event): Event {
  if (event.user?.email) event.user.email = "[redacted]";
  if (event.user?.ip_address) event.user.ip_address = "[redacted]";
  if (event.request?.cookies) {
    for (const key of Object.keys(event.request.cookies)) {
      if (/refresh-token|session-token|auth/.test(key)) {
        event.request.cookies[key] = "[redacted]";
      }
    }
  }
  scrubObject(event.tags);
  scrubObject(event.extra);
  scrubObject(event.contexts);
  return event;
}

function scrubObject(obj: any): void {
  if (!obj) return;
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === "string") {
      obj[k] = obj[k]
        .replace(EMAIL_RE, "[redacted-email]")
        .replace(IP_RE, "[redacted-ip]")
        .replace(VN_PHONE_RE, "[redacted-phone]");
    } else if (typeof obj[k] === "object") {
      scrubObject(obj[k]);
    }
  }
}

// apps/web/src/server/obs/posthog.ts
import { PostHog } from "posthog-node";
import crypto from "node:crypto";
import { redactPII } from "./pii-redactor";

const ph = new PostHog(process.env.POSTHOG_KEY!, { host: process.env.POSTHOG_HOST });

export function hashUserId(userEmail: string): string {
  return crypto.createHash("sha256").update(userEmail.toLowerCase() + process.env.POSTHOG_PII_SALT!).digest("hex").slice(0, 16);
}

export const posthog = {
  capture(input: { event: string; properties: Record<string, any> & { userEmail?: string; userId?: string }; userOptOut?: boolean }) {
    if (input.userOptOut) return;
    const { userEmail, userId, ...rest } = input.properties;
    const distinctId = userEmail ? hashUserId(userEmail) : userId ?? "anon";
    const props = redactPII({ extra: rest } as any).extra ?? {};
    ph.capture({ distinctId, event: input.event, properties: props });
  },
  async getFeatureFlag(flagKey: string, distinctId: string): Promise<boolean | string> {
    return ph.getFeatureFlag(flagKey, distinctId);
  },
  async shutdown() {
    return ph.shutdown();
  },
};

// apps/web/src/app/api/health/route.ts
import { mongo } from "@/server/db/mongo";
import { redis } from "@/server/queue/redis";
import { resend } from "@/server/email/resend";
import { timescale } from "@/server/db/timescale";

const START_TIME = Date.now();

export async function GET() {
  const timeout = (ms: number) => new Promise<false>(res => setTimeout(() => res(false), ms));

  const checks = {
    mongo: await Promise.race([mongo.db("salenoti").command({ ping: 1 }).then(() => true).catch(() => false), timeout(1000)]),
    redis: await Promise.race([redis.ping().then(() => true).catch(() => false), timeout(1000)]),
    resend: await Promise.race([resend.domains.list({ limit: 1 }).then(() => true).catch(() => false), timeout(1000)]),
    timescale: await Promise.race([(await timescale.healthCheck()).ok, timeout(1000)]),
  };
  const ok = Object.values(checks).every(Boolean);
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      checks,
      version: process.env.GIT_COMMIT ?? "dev",
      uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    },
    { status: ok ? 200 : 503 }
  );
}

// apps/web/src/server/obs/correlation.ts
import { ulid } from "ulid";
import { headers } from "next/headers";

export function getOrCreateCorrelationId(): string {
  const hdrs = headers();
  return hdrs.get("x-correlation-id") ?? ulid();
}

// apps/api/src/obs/correlation.middleware.ts (NestJS)
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id = (req.headers["x-correlation-id"] as string) ?? ulid();
    req.correlationId = id;
    res.setHeader("X-Correlation-Id", id);
    Sentry.setTag("correlationId", id);
    next();
  }
}
```

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | Sentry web project | test exception thrown | event captured at sentry.io with `release` and `environment` tags |
| AC2 | Sentry API project | test exception thrown | event captured; separate project from web |
| AC3 | PostHog SDK init | `posthog.capture("test", {})` | event visible in PostHog dashboard within 5min |
| AC4 | `posthog.capture()` with `userEmail: "u@x.com"` | inspect payload | `distinct_id` is 16-char hex hash; raw email absent |
| AC5 | `posthog.capture()` with `properties: { someText: "u@example.com" }` | inspect payload | property value contains `[redacted-email]` |
| AC6 | Sentry capture with `Sentry.setUser({ email: "u@x.com" })` | inspect event | event `user.email = "[redacted]"` |
| AC7 | Sentry breadcrumb POST with body | inspect event | breadcrumb body absent |
| AC8 | Sentry breadcrumb URL with `?token=abc` | inspect event | URL contains `token=[redacted]` |
| AC9 | feature flag `freemium_pricing_v1` toggle via Terraform | flag flipped | within 60s, client-side flag value updates |
| AC10 | `/api/health` request | all sub-checks healthy | 200 + JSON `{ status: "ok", checks: {...} }` + `uptime_seconds` |
| AC11 | `/api/health` with Mongo killed | response | 503 + `checks.mongo: false` |
| AC12 | Better Stack 4 monitors configured | dashboard | all green when services up |
| AC13 | BullMQ heartbeat misses ping | T+35min for tier1 | Slack `#oncall` alert |
| AC14 | killing the web pod | Vercel function error | Slack alert in `#oncall` within 3 min |
| AC15 | daily 09:00 ICT | cron tick | digest posted in `#daily-metrics` with DAU, CTR, signups, revenue |
| AC16 | week of soft-launch | PostHog dashboard | total events < 100K (well under 800K budget) |
| AC17 | user opts out (`analytics_opt_out: true`) | `posthog.capture()` invoked | call no-ops; no event sent |
| AC18 | API request with `X-Correlation-Id: abc-123` header | NestJS request | response header echoes `X-Correlation-Id: abc-123`; Sentry transaction tagged |
| AC19 | API request WITHOUT correlation header | middleware | generates ULID; response header set |
| AC20 | BullMQ job enqueued with correlationId | job error captured | Sentry event tags include `correlationId` matching origin request |
| AC21 | DSR delete cron run for user | Sentry data-purge API called | events for that distinctId hash purged |
| AC22 | Sentry event with VN phone in extras | inspect | phone redacted to `[redacted-phone]` |

---

## §5 — Verification

```ts
// apps/web/src/server/obs/__tests__/pii-redactor.spec.ts
describe("FR-OBS-001 — PII redactor", () => {
  it("AC6: redacts user.email", () => {
    const event = { user: { email: "u@x.com" } } as any;
    redactPII(event);
    expect(event.user.email).toBe("[redacted]");
  });
  it("AC5: redacts email in property values", () => {
    const event = { extra: { context: "from u@example.com" } } as any;
    redactPII(event);
    expect(event.extra.context).toContain("[redacted-email]");
  });
  it("AC22: redacts VN phone", () => {
    const event = { tags: { phone: "+84909123456" } } as any;
    redactPII(event);
    expect(event.tags.phone).toContain("[redacted-phone]");
  });
  it("AC8: redacts auth token cookie", () => {
    const event = { request: { cookies: { "authjs.refresh-token": "secret123" } } } as any;
    redactPII(event);
    expect(event.request.cookies["authjs.refresh-token"]).toBe("[redacted]");
  });
});

describe("FR-OBS-001 — PostHog wrapper", () => {
  it("AC4: distinctId is hash, raw email absent", async () => {
    const payloads: any[] = [];
    mockPostHogTransport(p => payloads.push(p));
    posthog.capture({ event: "test_event", properties: { userEmail: "user@example.com", price: 1000 } });
    await posthog.shutdown();
    expect(payloads[0].distinct_id).toMatch(/^[a-f0-9]{16}$/);
    expect(payloads[0].properties).toMatchObject({ price: 1000 });
    expect(JSON.stringify(payloads)).not.toContain("user@example.com");
  });

  it("AC17: opt-out users not captured", () => {
    const sent: any[] = [];
    mockPostHogTransport(p => sent.push(p));
    posthog.capture({ event: "test", properties: { userEmail: "u@x.com" }, userOptOut: true });
    expect(sent).toHaveLength(0);
  });
});

describe("FR-OBS-001 — health endpoint", () => {
  it("AC10: 200 when all healthy", async () => {
    const r = await fetch("/api/health");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toMatchObject({ mongo: true, redis: true, resend: true });
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("AC11: 503 when Mongo down", async () => {
    await killMongoClient();
    const r = await fetch("/api/health");
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.mongo).toBe(false);
  });
});

describe("FR-OBS-001 — correlation propagation", () => {
  it("AC18+AC19: correlation id flows through", async () => {
    const r = await fetch("/api/v1/products/track", { method: "POST", headers: { "X-Correlation-Id": "test-corr-123" } });
    expect(r.headers.get("X-Correlation-Id")).toBe("test-corr-123");
    expect(sentryMock.lastTransaction.tags.correlationId).toBe("test-corr-123");

    const r2 = await fetch("/api/v1/products/track", { method: "POST" });
    expect(r2.headers.get("X-Correlation-Id")).toMatch(/^[0-9A-Z]{26}$/); // ULID
  });
});
```

---

## §6 — Implementation skeleton

```bash
# Install
cd apps/web && pnpm add @sentry/nextjs@^8 posthog-js posthog-node ulid
cd apps/api && pnpm add @sentry/nestjs @sentry/node posthog-node ulid

# Sentry CLI (one-time, for source maps)
pnpm add -D @sentry/wizard
npx @sentry/wizard@latest -i nextjs

# Doppler secrets
doppler secrets set SENTRY_DSN_WEB= …
doppler secrets set SENTRY_DSN_API= …
doppler secrets set POSTHOG_KEY=phc_…
doppler secrets set POSTHOG_HOST=https://us.i.posthog.com
doppler secrets set POSTHOG_PII_SALT=$(openssl rand -hex 32)
doppler secrets set BETTER_STACK_TOKEN= …
doppler secrets set SLACK_OBS_WEBHOOK=https://hooks.slack.com/…
```

Better Stack via web console (or Terraform):
- Monitor `salenoti-web` → `https://sale.cyber.skill`, 60s interval.
- Monitor `salenoti-health` → `https://sale.cyber.skill/api/health`, 30s, JSON body keyword `"ok"`.
- Monitor `salenoti-api` → `https://api.sale.cyber.skill/health`, 30s.
- Heartbeat `cron-price-check-tier1-30m` → period 30 min, grace 5 min.
- Heartbeat `cron-price-check-tier2-6h` → period 6h, grace 30 min.
- Heartbeat `cron-daily-metrics-digest` → period 24h, grace 1h.

```hcl
# infra/posthog-flags.tf
resource "posthog_feature_flag" "freemium_pricing_v1" {
  key   = "freemium_pricing_v1"
  name  = "Freemium pricing (Pro/Pro+ visible)"
  active = false
  rollout_percentage = 0
}
resource "posthog_feature_flag" "mega_sale_mode_2026_11_11" {
  key  = "mega_sale_mode_2026_11_11"
  active = false
  filters {
    groups {
      properties {
        key = "$current_date"
        operator = "gte"
        value = "2026-11-04"
      }
    }
  }
}
```

---

## §7 — Dependencies

- Doppler envs: `SENTRY_DSN_WEB`, `SENTRY_DSN_API`, `POSTHOG_KEY`, `POSTHOG_HOST`, `POSTHOG_PII_SALT`, `BETTER_STACK_TOKEN`, `SLACK_OBS_WEBHOOK`, `IP_SALT`, `UA_SALT`.
- Slack workspace with channels: `#oncall`, `#daily-metrics`, `#founder-incidents`.
- Vercel + Railway env vars configured.
- Sentry projects: `salenoti-web`, `salenoti-api`.
- PostHog project: `salenoti-prod`.
- Better Stack workspace: `salenoti`.

---

## §8 — Example payloads

### Sentry alert in `#oncall`

```
🚨 [Sentry] CRITICAL · salenoti-web
Error: MongoNetworkError: Server selection timed out after 30000 ms
Release: a1b2c3d
Environment: production
First seen: 2026-05-16 14:32:11 UTC
URL: https://sale.cyber.skill/dashboard
Tags: fr=FR-WATCH-001, correlationId=01JZ...
🔗 View: https://sentry.io/.../issues/xxxxx/
```

### Daily metrics digest in `#daily-metrics`

```
📊 SaleNoti — 2026-05-15

*Users & Engagement*
- DAU: 234 (+8% WoW)  [insight 5829]
- New signups: 41
- D7 retention: 27% ✅ (target 25%)

*Tracking & Alerts*
- Products tracked (cumulative): 4,851 (+312 today)
- Alerts sent: 187 (email: 142, push: 31, telegram: 14)
- Alerts clicked: 49 → CTR 26.2% ✅ (target 25%)

*Revenue*
- Affiliate revenue (24h est): 95,000 ₫
- Subscription MRR: 1,950,000 ₫ (50 Pro users)
- Free→Pro conversions today: 3

*Free-tier funnel*
- Users hitting 10-product cap: 22
- Upgrade after cap: 5 → 22.7% conversion ✅
```

### PostHog event with hashed distinctId

```json
{
  "event": "product_tracked",
  "distinct_id": "ab12cd34ef567890",
  "properties": {
    "shopId": 123,
    "itemId": 4567,
    "productId": "123-4567",
    "source": "ext",
    "hasNickname": false,
    "triggerCount": 1,
    "correlationId": "01JZAB...",
    "$lib": "posthog-node",
    "$lib_version": "4.0.0"
  }
}
```

---

## §9 — Open questions (resolved)

**Q1: Self-host PostHog or use cloud?**
A: Cloud at MVP (zero ops cost). Re-evaluate if monthly volume > 500K events or compliance review demands EU/SG hosting. PostHog OSS image is straightforward to self-host on Railway if needed.

**Q2: PII hashing with HMAC or plain hash + salt?**
A: Plain SHA-256 + salt (16-char prefix). HMAC offers no extra value for analytics (we're not authenticating, just pseudonymizing).

**Q3: Better Stack vs UptimeRobot vs StatusCake?**
A: Better Stack per plan §C10. UptimeRobot doesn't expose JSON-body assertion for `/api/health`. StatusCake is similar to UptimeRobot. Better Stack also bundles log ingestion (Logtail), reducing tool count.

**Q4: Sentry 0.1 sample rate too low?**
A: 0.1 for traces (perf), 1.0 for errors (always). Default for MVP; tune upward to 0.5 only if specific perf issue requires investigation (then back to 0.1).

**Q5: Should health endpoint check Stripe/Resend availability?**
A: Resend yes (transactional path); Stripe no (called only on payment flow, not every request). Adding Stripe to /health makes it sensitive to Stripe's own uptime, which is fine but adds noise.

**Q6: PostHog session replay?**
A: Disabled at MVP. Session replay captures DOM mutations — high risk for PII leak. P2 may enable on a specific page (signup) with explicit redaction config.

**Q7: How does PostHog distinctId reconcile across anon → authenticated transition?**
A: PostHog's `posthog.alias(anonId, distinctId)` call on sign-in merges the anonymous and authenticated sessions. Event continuity preserved.

**Q8: What if Sentry's beforeSend has a bug and PII leaks?**
A: `docs/obs/runbook-pii-leak.md` covers: detect (manual audit + grep against Sentry export), purge (Sentry data-purge API), notify DPO + counsel, file with A05 if material per FR-LEGAL-001 §1 #6.

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Sentry quota exhausted | "quota exceeded" email from Sentry | errors lost; alerts may not fire | upgrade plan or filter noisy errors (e.g., known browser-extension conflicts) | error |
| 2 | PostHog quota exhausted | Better Stack dashboard or PostHog email | events dropped client-side | increase sampling rate or upgrade tier ($0.0001/event after 1M) | warning |
| 3 | Better Stack false positive (intermittent DNS) | 3 consecutive fails | Slack alert noise | tune to "3 of last 5" or DNS-level monitor; or whitelist transient flakes | warning |
| 4 | `/api/health` slow (Mongo > 1s) | check times out, returns false | 503; Better Stack flips red | investigate; if Atlas slow, raise priority alert; consider local fallback | warning |
| 5 | PII leaked in Sentry (`beforeSend` bug) | manual audit grep against Sentry export | runbook (`docs/obs/runbook-pii-leak.md`); Sentry data-purge API | engineer review; tighten `beforeSend`; A05 filing if material | error |
| 6 | Slack webhook expired | Slack returns 404 to OBS posts | alerts not delivered | rotate webhook; OBS monitors itself via Better Stack heartbeat on alert path | warning |
| 7 | Doppler secret rotation breaks SDK | Init error | Sentry/PostHog dark for that pod | Doppler rolling restart with N-1 acceptance | warning |
| 8 | Sentry release tagging missing | cannot bisect to commit | manual via git log | CI MUST set `GIT_COMMIT` env at build (Vercel/Railway support) | error |
| 9 | `instrumentation.ts` ordering broken (Sentry init too late) | first-load errors uncaptured | edge case mostly cold-start | ensure import in `register()` is await'd | warning |
| 10 | Vercel function cold-start delays Sentry init | some early errors miss | Sentry has `autoSessionTracking` fallback | accept gracefully; rare | info |
| 11 | Correlation ID not propagated to BullMQ job | error in worker has no link to source | job data MUST include `correlationId` field | enforce via worker middleware | warning |
| 12 | PostHog `bootstrap` flag fetch fails (network) | client-side flag eval falls back to default | accept; default `false` is safe | re-evaluate on next page load | info |
| 13 | Better Stack outage (their service down) | our monitors flap | accept; rare; provider has 99.9% SLA | dual-provider if reaches 100K users (P3) | warning |
| 14 | Daily metrics digest cron fails (PostHog API down) | Slack expecting digest at 09:00 ICT | OBS heartbeat catches | retry with backoff; manual re-run if still failed at 10:00 | warning |
| 15 | Feature flag flipped accidentally (no Terraform plan reviewed) | PostHog audit log | Terraform-only enforcement; manual UI changes flagged in monthly audit | revert via Terraform; document in runbook | error |
| 16 | DSR delete cron purges PostHog events for wrong user | hash collision (~2^64 chance) | accept extremely-rare risk | re-purge via specific event search | info |
| 17 | Sentry beforeBreadcrumb removes a useful field | engineer can't repro from breadcrumbs | balance redaction vs utility | add specific carve-outs for known-safe fields | info |

---

## §11 — Notes

- All three pillars are free-tier eligible for P0/P1 traffic; first paid pillar is likely Better Stack (6 monitors > 5 free) at $24/mo, then PostHog at ~10K MAU.
- `instrumentation.ts` is Next.js's only canonical SSR-init hook. Don't fight it.
- The daily metrics Slack post (§1 #21) is the founder's primary engagement loop with the product. Keep it short and absolute. No vanity metrics (e.g., "page views" without conversion context).
- `correlationId` propagation is the single most valuable observability investment; it converts "scattered events across 3 tools" into "one trace, three views". Worth the middleware effort.
- Terraform-versioned feature flags prevent the "what changed last Tuesday at 2pm?" mystery. Manual UI changes should require a Terraform import to backfill.
- The PII-redactor is intentionally aggressive — it's better to redact `"This message from u@x.com is about..."` to `"This message from [redacted-email] is about..."` (still readable) than to leak. Engineers can request specific carve-outs via PR if redaction is over-aggressive.
- Session replay disabled at MVP is a deliberate trade-off: replay is one of the most powerful debugging tools but creates the highest-stakes PII-leak surface. Enable selectively post-MVP after redaction config is hardened.

---

*FR-OBS-001 spec — last revised 2026-05-16. Status: shipped (2026-05-17).*
