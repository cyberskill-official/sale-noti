---
id: FR-NOTIF-001
title: "Email alert via Resend — React Email template · idempotency-key dedup · 365-day TTL audit log · suppression list"
module: NOTIF
priority: MUST
status: accepted
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: "Intern #2 (BE) supervised by Senior Tech Lead"
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-WATCH-002, FR-AFF-002, FR-LEGAL-002, FR-WORKER-001, FR-NOTIF-002, FR-NOTIF-003]
depends_on: [FR-WATCH-002, FR-LEGAL-002, FR-WORKER-001]
blocks: [FR-NOTIF-002, FR-NOTIF-003, FR-GROW-002]
effort_hours: 10
template: engineering-spec@1

new_files:
  - apps/api/src/notify/notify-email.service.ts
  - apps/api/src/notify/notify-orchestrator.service.ts
  - apps/api/src/notify/notify-suppression.service.ts
  - apps/api/src/notify/notify-webhook.controller.ts
  - apps/api/src/notify/notify-types.ts
  - apps/web/src/server/email/templates/alert.tsx
  - apps/web/src/server/email/templates/alert.spec.tsx
  - apps/api/src/notify/__tests__/notify-email.spec.ts
  - apps/api/src/notify/__tests__/notify-webhook.spec.ts
  - apps/api/src/notify/__tests__/notify-suppression.spec.ts
modified_files:
  - apps/api/src/queue/queues.ts
  - apps/api/src/app.module.ts
allowed_tools: ["file_read/write apps/api/**", "file_read/write apps/web/**", "bash pnpm test"]
disallowed_tools:
  - "send alert without disclosure paragraph (FR-LEGAL-002 §1 #4) — snapshot test enforces"
  - "send alert without idempotency key (duplicates spam users) — unique index enforces"
  - "log full email body / token / affiliate URL in OBS (PII / commission leak)"
  - "store user.email in suppressionList in plaintext — MUST sha256 hash with salt"
  - "render dynamic HTML from un-escaped template vars — React Email auto-escapes via JSX"
risk_if_skipped: "Plan §I phase 1 success metrics ALL depend on alerts firing: Alerts sent 5000, CTR ≥ 25%, D7 ≥ 25%. No email = no MVP signal. This FR is also the dispatch foundation that FR-NOTIF-002 (push) and FR-NOTIF-003 (Telegram) extend; the idempotency/suppression/audit infrastructure here is shared."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The notify service MUST dispatch alert emails when a trigger fires.

1. The system MUST subscribe a BullMQ worker to the `alert-dispatch` queue (FR-WORKER-001). The queue payload shape MUST be `{ userId, watchlistId, triggerKind: "pct_drop"|"absolute_drop"|"target_price"|"lowest_30d"|"flash_sale", observedAt: ISO, observedPrice, baseline?, channels: ("email"|"push"|"telegram")[] }`.
2. The worker MUST process per-channel within a single job: for each channel in `job.data.channels` (the orchestrator FR-NOTIF-001 fans out to email/push/Telegram). Each channel handler MUST be independently idempotent (so retry of one channel doesn't double-send another).
3. The email handler MUST compute idempotency key as `idem_email = sha256(userId + "|" + watchlistId + "|" + triggerKind + "|" + observedAt.toISOString() + "|" + EMAIL_IDEM_SALT).slice(0, 32)`. The unique index `{ idem: 1, channel: 1 }` on `notifications` collection MUST be created in migration. Duplicate insert MUST be a no-op (catch error code 11000).
4. The email body MUST be rendered via React Email template `alert.tsx` containing: product name, image (CDN URL not inline), current price, original price, discount %, baseline-at-track price (from FR-WATCH-002 trigger context), last-30-day-min, sparkline (data-URI SVG, max 8KB), affiliate-tagged CTA URL (via FR-AFF-002 with `sub=alert_<triggerKind>_<watchlistId>`), the **disclosure paragraph** from FR-LEGAL-002 §1 #4 (copy constant, lint-enforced), one-click unsubscribe link, "manage alerts" link.
5. The email MUST be sent through Resend with:
   - `from: "SaleNoti <alerts@cyberskill.world>"`
   - `tags: [{ name: "fr", value: "FR-NOTIF-001" }, { name: "trigger", value: <kind> }, { name: "user_cohort", value: <free|pro> }]`
   - `headers: { "List-Unsubscribe": "<https://sale.cyber.skill/unsubscribe?u=<userId>&t=<token>>, <mailto:unsubscribe@cyberskill.world>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }`
   - The subject line MUST follow the template `<emoji> <productName> giảm <pct>% — <formattedPrice>` truncated to 78 chars (RFC 5322 recommended max).
6. The email row MUST persist `affiliateLinkId` referencing the `affiliate_links` row created by FR-AFF-002, so commission reconciliation can join `notifications → affiliate_links → conversions` for the transparency report.
7. On successful send, the worker MUST update the watchlist's per-trigger cooldown: `watchlists.triggerCooldowns[triggerKind] = now()` AND `watchlists.lastNotifiedAt = now()`. This cooldown is read by FR-WATCH-002 trigger eval to prevent re-fire.
8. The system MUST expose webhook endpoint `POST /webhooks/resend` accepting Resend's webhook events (`email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.delivery_delayed`). The handler MUST:
   - Verify the `resend-signature` header via HMAC-SHA256 with `RESEND_WEBHOOK_SECRET`; reject mismatched signatures with 401.
   - Update the matching `notifications` row by `(idem, channel: "email")` lookup.
   - For `bounced` (hard) → increment user bounce counter; if ≥ 2 → add to `suppressionList`.
   - For `complained` → immediately add to `suppressionList` (one strike).
   - Be idempotent (repeat webhook delivery is a Resend pattern); use `webhookEventId` as the dedup key.
9. Notification audit rows MUST be retained for 365 days via MongoDB TTL index on `sentAt`. Plan §C3 audit-window requirement. After TTL purge, aggregate stats (counts by trigger, channel) MAY be retained indefinitely in a separate `notification_stats` collection.
10. The per-user daily email cap MUST be 20 alerts/24h rolling window. The 21st alert MUST be deferred to next 09:00 local (Asia/Ho_Chi_Minh) with `defer_reason: "daily_cap"` audit log and PostHog `alert_deferred` event. Per-trigger urgency MAY override (P2): `flash_sale` triggers bypass cap.
11. The `suppressionList` collection MUST hold `{ email_hash: sha256(lowercase(email)+SALT).slice(0,32), reason: "hard_bounce"|"complaint"|"manual", addedAt, sourceEvent }`. The email handler MUST check suppression BEFORE sending; suppressed users MUST NOT receive email but the trigger cooldown SHALL still be set (so we don't re-evaluate next cycle wasting compute).
12. The dispatch latency p95 (queue dequeue → Resend `send()` acknowledgment) MUST be < 600 ms under normal conditions; < 1500ms with cold cache. The system MUST emit PostHog metric `alert_dispatch_latency_ms`.
13. The unsubscribe token MUST be `sha256(userId + watchlistId + UNSUB_SALT).slice(0, 24)`; visiting `/unsubscribe?u=<userId>&t=<token>&watchlistId=<wlId>` MUST:
    - Validate token; reject mismatch with 401.
    - If `watchlistId` present → pause that single watchlist's email channel.
    - If `watchlistId` omitted → set `users.notificationChannels.email = false` (full opt-out).
    - Log `notification_unsubscribed` to PostHog.
14. The email MUST render correctly in: Gmail (web + iOS + Android), Apple Mail (macOS + iOS), Outlook (web + desktop 2019+), Yahoo Mail. The template MUST use `<table>` layout for Outlook compatibility (Outlook uses Word's HTML renderer); inline styles only (no `<style>` blocks); max 600px width.
15. The system MUST tag each email with X-PM-Message-Stream or equivalent for transactional vs. marketing separation (alerts are transactional under CAN-SPAM); the `List-Unsubscribe` is still required for Gmail bulk-sender compliance (Feb 2024 ruleset).
16. PII leakage protection: error logs from this service MUST redact `email` and full `affiliateLink` to `email_hash` and `affiliate_link_id` respectively. Sentry's `beforeSend` (FR-OBS-001) covers this; the service MUST verify behavior via test.

---

## §2 — Why this design

**Why Resend (not raw SMTP, not Postmark, not SendGrid):** plan §C6 mandates Resend. SPF/DKIM/DMARC pre-configured, React Email templates native, free tier 3K/month then $20/50K — cheapest at MVP scale. Postmark is slightly more reliable but 2x cost; SendGrid is overkill at MVP. Raw SMTP via SES requires us to manage IP warmup + reputation, which is operationally heavy for a 2-person team.

**Why idempotency keys (and unique index, not application-level dedup):** BullMQ retries failed jobs (default 3 retries). Without idem, retry triggers duplicate email. Application-level dedup via Redis `SET NX` is faster but loses guarantees on Redis eviction; MongoDB unique index is durable. The 32-char SHA-256 prefix balances index size vs collision probability (~ 2^128, well under practical collision risk).

**Why per-channel idem (not per-job):** the orchestrator might successfully send email but fail on Telegram, triggering BullMQ retry. Per-channel idem keys mean retry only re-attempts the failed channel; email isn't double-sent. This is critical for `channels: ["email", "push", "telegram"]` jobs where partial failure is common.

**Why daily cap 20:** plan §I Phase 1 target — 5K alerts / 250 users = 20/user/day average. A user genuinely hitting 20 likely has alert config too loose (e.g., 5% drop threshold across 30 watchlists). The cap is a soft signal to re-configure; we don't want to suppress real value, but we also don't want to be the daily-spam newsletter that gets gmail-foldered.

**Why suppressionList (hard bounce ≥ 2 OR complaint ≥ 1):** Resend reputation lives or dies on sender domain health. ≥ 2 hard bounces (mailbox doesn't exist, domain doesn't exist) or ≥ 1 complaint (user marked as spam) materially harms sender reputation. The asymmetric threshold (1 complaint vs 2 bounces) reflects severity — a complaint signals user-perceived spam, which is much worse than a typo'd address.

**Why disclosure paragraph mandatory + lint-enforced + snapshot-tested:** FR-LEGAL-002 §1 #4 ethics rule + plan §A2 ("Honey-style scandal" risk). Three layers of enforcement: (a) copy stored in a single shared constant `AFFILIATE_DISCLOSURE_VI`, (b) custom ESLint rule blocks template literals containing "shopee" or "affiliate" without importing the constant, (c) snapshot test on the React Email template asserts the exact disclosure substring is present. Drift here is reputationally catastrophic.

**Why store `affiliateLinkId` (not the full URL):** the affiliate URL contains `sub=<watchlistId>` and user-specific tracking; storing it in `notifications` rows would leak watch identity to anyone with notification-table access (e.g., support staff debugging). Storing only the FK lets reconciliation join when needed without leaking ambient.

**Why one-click unsubscribe + List-Unsubscribe header (RFC 8058):** Gmail's Feb 2024 bulk-sender rules require both headers AND a working one-click endpoint, or your messages get heavily-throttled to spam folders. We're transactional (not marketing), but Gmail's classifier increasingly bucket "this came from a service" as bulk regardless.

**Why per-trigger cooldown (not per-watchlist):** users want different rhythms per trigger type. A `pct_drop` 5% trigger firing every 12h is fine; the same watchlist's `flash_sale` trigger firing within 1h is the high-value urgent signal. Per-trigger cooldown lets us be aggressive on urgent triggers, conservative on routine ones. FR-WATCH-002 §1 sets the cooldown values.

**Why suppress-but-still-set-cooldown:** if a user is on the suppression list and we just `return` without setting the cooldown, FR-WATCH-002 will keep evaluating their triggers every cycle, generating queue jobs that ultimately discard. Setting cooldown short-circuits the eval cycle and saves worker CPU.

**Why unsubscribe token is sha256-deterministic (not random):** users tend to lose unsubscribe emails or click old ones. A random token requires DB lookup + rotation; a deterministic token derived from (userId, watchlistId, salt) is stable, self-validating, and stateless. Trade-off: revoke means rotating UNSUB_SALT (rare event).

---

## §3 — API contract & code shape

### Queue job shape

```ts
type AlertJobData = {
  userId: string;
  watchlistId: string;
  triggerKind: "pct_drop" | "absolute_drop" | "target_price" | "lowest_30d" | "flash_sale";
  observedAt: Date;
  observedPrice: number;
  baseline?: number;             // baseline at track time
  baselineLow30d?: number;
  channels: ("email" | "push" | "telegram")[];
  jobMeta: { enqueuedAt: Date; correlationId: string };
};
```

### Notifications row schema

```ts
type NotificationRow = {
  _id: ObjectId;
  userId: string;
  watchlistId: string;
  channel: "email" | "push" | "telegram";
  idem: string;                  // sha256 prefix(32)
  triggerKind: string;
  affiliateLinkId?: ObjectId;    // FK to affiliate_links
  sentAt: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  bouncedAt?: Date;
  complainedAt?: Date;
  deferredReason?: "daily_cap" | "quiet_hours" | "suppression_list";
  resendMessageId?: string;
  correlationId: string;
};
```

### Webhook contract

```http
POST /webhooks/resend
Resend-Signature: t=<timestamp>,v1=<hex>
Content-Type: application/json

{
  "type": "email.bounced",
  "created_at": "2026-05-16T10:00:00Z",
  "data": {
    "email_id": "msg_abc123",
    "to": ["user@example.com"],
    "tags": [{ "name": "fr", "value": "FR-NOTIF-001" }],
    "bounce": { "type": "hard", "reason": "Mailbox does not exist" }
  }
}

→ 200 OK  { "received": true }
→ 401 if signature mismatch
```

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | trigger fires for free user with email channel enabled | job enqueued | email sent via Resend; `notifications` row inserted; watchlist `triggerCooldowns[kind]` set |
| AC2 | same job data re-tried | second invocation | `notifications` insert hits unique-index 11000; handler returns without 2nd Resend call |
| AC3 | rendered email HTML | snapshot test | contains exact `AFFILIATE_DISCLOSURE_VI` substring; one-click unsubscribe link with valid token |
| AC4 | user has `notificationChannels.email: false` | job dispatched | handler skips Resend call; `notifications` row NOT inserted; PostHog `alert_skipped_channel_disabled` |
| AC5 | user email_hash in suppressionList | job dispatched | skip Resend call; cooldown still set on watchlist; PostHog `alert_suppressed` |
| AC6 | 21st email/24h to same user | job dispatched | `notifications` row with `deferredReason: "daily_cap"`; new BullMQ job enqueued at 09:00 next day |
| AC7 | Resend webhook `email.delivered` for known message | POST /webhooks/resend | matching `notifications.deliveredAt` set; HMAC verified |
| AC8 | Resend webhook `email.bounced` type=hard, 2nd for same email | POST /webhooks/resend | `suppressionList` entry created; future jobs for that user 5x skip |
| AC9 | Resend webhook `email.complained` (1 strike) | POST /webhooks/resend | `suppressionList` entry created immediately |
| AC10 | webhook with mismatched HMAC signature | POST /webhooks/resend | 401; no DB change |
| AC11 | 1000 jobs enqueued in parallel | worker processes | p95 dispatch latency < 600ms; no duplicates |
| AC12 | unsubscribe URL clicked (valid token, watchlistId) | GET /unsubscribe | watchlist's `alertConfig.channels` removes "email"; PostHog `notification_unsubscribed` |
| AC13 | unsubscribe URL with wrong token | GET /unsubscribe | 401; no state change |
| AC14 | error in handler (Resend 500) | retry | Bull retries job; idempotency prevents double-send on retry-after-success |
| AC15 | email rendered for Gmail | render check | HTML uses `<table>` layout, inline styles, max 600px width; no `<style>` blocks |
| AC16 | error captured in Sentry | dispatch fails | email and affiliateLink redacted; only `email_hash`, `affiliate_link_id` in context |
| AC17 | notification 366 days old | TTL cron | row purged; aggregate stat persists |
| AC18 | flash_sale trigger after 20-cap hit | dispatched | (P2) bypass cap; ship at MVP with cap enforced uniformly |

---

## §5 — Verification

```ts
describe("FR-NOTIF-001 — email alert", () => {
  beforeEach(async () => { await mongo.db("salenoti").collection("notifications").deleteMany({}); await mongo.db("salenoti").collection("suppressionList").deleteMany({}); resendMock.reset(); });

  it("AC1: trigger fires → email sent + row persisted + cooldown set", async () => {
    const data: AlertJobData = makeAlertJob({ userId: "u1", triggerKind: "pct_drop" });
    await alertDispatchQueue.add("alert", data);
    await waitForJobs(alertDispatchQueue);
    expect(resendMock.sent).toHaveLength(1);
    expect(resendMock.sent[0].tags).toContainEqual({ name: "fr", value: "FR-NOTIF-001" });
    const row = await mongo.db("salenoti").collection("notifications").findOne({ userId: "u1" });
    expect(row?.idem).toMatch(/^[a-f0-9]{32}$/);
    const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: new ObjectId(data.watchlistId) });
    expect(wl?.triggerCooldowns?.pct_drop).toBeDefined();
  });

  it("AC2: idempotent retry", async () => {
    const data = makeAlertJob({ userId: "u1" });
    await alertDispatchQueue.add("a", data);
    await alertDispatchQueue.add("a", data);  // duplicate
    await waitForJobs(alertDispatchQueue);
    expect(resendMock.sent).toHaveLength(1);
    expect(await mongo.db("salenoti").collection("notifications").countDocuments({ idem: { $exists: true } })).toBe(1);
  });

  it("AC3: disclosure in HTML snapshot", () => {
    const html = render(<AlertEmail
      product={fixtureProduct}
      watchlist={fixtureWatch}
      triggerKind="pct_drop"
      ctaUrl="https://shope.ee/x"
      unsubscribeUrl="https://sale.cyber.skill/unsubscribe?u=u1&t=abc123"
      disclosure={AFFILIATE_DISCLOSURE_VI}
    />);
    expect(html).toContain("SaleNoti là price-tracker affiliate");
    expect(html).toContain("KHÔNG: tự áp coupon");
    expect(html).toContain("Hủy nhận");
    expect(html).toMatchSnapshot();
  });

  it("AC4: user opted-out of email channel", async () => {
    await mongo.db("salenoti").collection("users").updateOne({ _id: "u1" }, { $set: { "notificationChannels.email": false } });
    await alertDispatchQueue.add("a", makeAlertJob({ userId: "u1" }));
    await waitForJobs(alertDispatchQueue);
    expect(resendMock.sent).toHaveLength(0);
  });

  it("AC5: suppressionList skip but cooldown set", async () => {
    const user = await mongo.db("salenoti").collection("users").findOne({ _id: "u1" });
    await mongo.db("salenoti").collection("suppressionList").insertOne({ email_hash: sha256(user!.email.toLowerCase() + process.env.EMAIL_HASH_SALT).slice(0, 32), reason: "hard_bounce", addedAt: new Date() });
    const job = makeAlertJob({ userId: "u1" });
    await alertDispatchQueue.add("a", job);
    await waitForJobs(alertDispatchQueue);
    expect(resendMock.sent).toHaveLength(0);
    const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: new ObjectId(job.watchlistId) });
    expect(wl?.triggerCooldowns?.[job.triggerKind]).toBeDefined();
  });

  it("AC6: 21st email defers with audit row", async () => {
    for (let i = 0; i < 20; i++) await fakeAlreadySent("u1", new Date(Date.now() - i * 60_000));
    const job = makeAlertJob({ userId: "u1" });
    await alertDispatchQueue.add("a", job);
    await waitForJobs(alertDispatchQueue);
    expect(resendMock.sent).toHaveLength(0);
    const row = await mongo.db("salenoti").collection("notifications").findOne({ userId: "u1", deferredReason: "daily_cap" });
    expect(row).toBeDefined();
    const deferredJobs = await alertDispatchQueue.getJobs(["delayed"]);
    expect(deferredJobs.length).toBeGreaterThan(0);
  });

  it("AC8: hard bounce 2x → suppressionList", async () => {
    await postWebhook({ type: "email.bounced", data: { email_id: "msg1", to: ["u@y.com"], bounce: { type: "hard" } } });
    await postWebhook({ type: "email.bounced", data: { email_id: "msg2", to: ["u@y.com"], bounce: { type: "hard" } } });
    const supp = await mongo.db("salenoti").collection("suppressionList").findOne({ email_hash: sha256("u@y.com" + process.env.EMAIL_HASH_SALT).slice(0, 32) });
    expect(supp).toBeDefined();
  });

  it("AC10: webhook bad signature → 401", async () => {
    const r = await api.post("/webhooks/resend").set("resend-signature", "t=123,v1=badbeef").send({ type: "email.delivered", data: {} });
    expect(r.status).toBe(401);
  });

  it("AC12: unsubscribe link works for single watchlist", async () => {
    const wl = await seedWatchlist("u1", "p1", { alertConfig: { channels: ["email", "push"] } });
    const token = sha256("u1" + wl._id.toString() + process.env.UNSUB_SALT).slice(0, 24);
    const r = await api.get(`/unsubscribe?u=u1&watchlistId=${wl._id}&t=${token}`);
    expect(r.status).toBe(200);
    const after = await mongo.db("salenoti").collection("watchlists").findOne({ _id: wl._id });
    expect(after?.alertConfig.channels).toEqual(["push"]);
  });

  it("AC15: HTML uses Outlook-friendly layout", () => {
    const html = render(<AlertEmail {...fixtureProps} />);
    expect(html).toMatch(/<table/);
    expect(html).not.toMatch(/<style[^>]*>/);
    expect(html).toMatch(/max-width:\s*600px/);
  });

  it("AC16: Sentry context redacts email", async () => {
    sentryMock.reset();
    resendMock.failNext({ status: 500, message: "internal" });
    await alertDispatchQueue.add("a", makeAlertJob({ userId: "u1" }));
    await waitForJobs(alertDispatchQueue);
    const cap = sentryMock.lastCapture;
    expect(JSON.stringify(cap)).not.toContain("@");      // no email
    expect(JSON.stringify(cap)).toMatch(/email_hash/);
  });
});
```

---

## §6 — Implementation skeleton

```ts
// apps/api/src/notify/notify-email.service.ts
@Processor("alert-dispatch")
export class NotifyEmailProcessor extends WorkerHost {
  constructor(
    private readonly resend: ResendClient,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly deeplink: DeeplinkService,
    private readonly suppression: SuppressionService,
    private readonly posthog: PostHogService,
  ) { super(); }

  async process(job: Job<AlertJobData>): Promise<void> {
    const t0 = performance.now();
    const { userId, watchlistId, triggerKind, observedAt, channels, correlationId } = job.data;

    if (!channels.includes("email")) return;

    const user = await this.db.users.findOne({ _id: userId });
    if (!user) { this._capture("user_not_found", { userId: hashUserId(userId) }); return; }
    if (!user.notificationChannels?.email) {
      this.posthog.capture({ event: "alert_skipped_channel_disabled", properties: { trigger: triggerKind, userId: hashUserId(userId) } });
      return;
    }

    const emailHash = sha256(user.email.toLowerCase() + process.env.EMAIL_HASH_SALT).slice(0, 32);
    if (await this.suppression.isSuppressed(emailHash)) {
      await this._setCooldown(watchlistId, triggerKind);
      this.posthog.capture({ event: "alert_suppressed", properties: { reason: "suppression_list", trigger: triggerKind } });
      return;
    }

    if (await this._sentTodayCount(userId) >= 20) {
      await this._deferToTomorrow(job.data, "daily_cap");
      await this.db.notifications.insertOne({ userId, watchlistId, channel: "email", deferredReason: "daily_cap", correlationId, sentAt: new Date() });
      return;
    }

    const idem = sha256(`${userId}|${watchlistId}|${triggerKind}|${observedAt.toISOString()}|${process.env.EMAIL_IDEM_SALT}`).slice(0, 32);

    try {
      await this.db.notifications.insertOne({
        userId, watchlistId, channel: "email", idem, triggerKind,
        correlationId, sentAt: new Date(),
      });
    } catch (e: any) {
      if (e.code === 11000) return; // idempotent — already sent
      throw e;
    }

    const wl = await this.db.watchlists.findOne({ _id: new ObjectId(watchlistId) });
    const product = await this.db.products.findOne({ productId: wl!.productId });
    const link = await this.deeplink.generateShortLink({ userId, productUrl: product!.url, sub: `alert_${triggerKind}_${watchlistId}` });
    const unsubToken = sha256(userId + watchlistId + process.env.UNSUB_SALT).slice(0, 24);
    const unsubUrl = `https://sale.cyber.skill/unsubscribe?u=${userId}&watchlistId=${watchlistId}&t=${unsubToken}`;

    try {
      const result = await this.resend.emails.send({
        from: "SaleNoti <alerts@cyberskill.world>",
        to: user.email,
        subject: truncateSubject(formatSubject(product!, triggerKind, job.data.observedPrice)),
        react: AlertEmail({ product: product!, watchlist: wl!, triggerKind, observedPrice: job.data.observedPrice, baseline: job.data.baseline, ctaUrl: link.shortLink, unsubscribeUrl: unsubUrl, disclosure: AFFILIATE_DISCLOSURE_VI }),
        tags: [{ name: "fr", value: "FR-NOTIF-001" }, { name: "trigger", value: triggerKind }, { name: "user_cohort", value: user.plan }],
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>, <mailto:unsubscribe@cyberskill.world?subject=u-${userId}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await this.db.notifications.updateOne({ idem, channel: "email" }, { $set: { resendMessageId: result.id, affiliateLinkId: link.linkId } });
    } catch (e) {
      // Don't delete the notifications row — re-attempt via retry will detect idem and skip
      this._capture("resend_send_failed", { trigger: triggerKind, userId: hashUserId(userId), email_hash: emailHash });
      throw e;
    }

    await this._setCooldown(watchlistId, triggerKind);
    this.posthog.capture({ event: "alert_sent", properties: { channel: "email", trigger: triggerKind, userId: hashUserId(userId), latency_ms: Math.round(performance.now() - t0) } });
  }

  private async _setCooldown(watchlistId: string, kind: string): Promise<void> {
    await this.db.watchlists.updateOne(
      { _id: new ObjectId(watchlistId) },
      { $set: { [`triggerCooldowns.${kind}`]: new Date(), lastNotifiedAt: new Date() } }
    );
  }

  private async _sentTodayCount(userId: string): Promise<number> {
    return this.db.notifications.countDocuments({
      userId, channel: "email",
      sentAt: { $gte: new Date(Date.now() - 24 * 3600_000) },
      deferredReason: { $exists: false },
    });
  }

  private async _deferToTomorrow(data: AlertJobData, reason: string): Promise<void> {
    const next9am = nextLocalTime("Asia/Ho_Chi_Minh", 9, 0);
    await alertDispatchQueue.add("alert", data, { delay: next9am.getTime() - Date.now(), attempts: 3 });
  }

  private _capture(event: string, props: Record<string, unknown>): void {
    Sentry.captureMessage(event, { tags: { fr: "FR-NOTIF-001" }, contexts: { props } });
  }
}

function formatSubject(product: Product, kind: string, price: number): string {
  const emoji = { pct_drop: "🔥", absolute_drop: "💸", target_price: "🎯", lowest_30d: "📉", flash_sale: "⚡" }[kind] ?? "🔔";
  return `${emoji} ${product.name} — ${formatVnd(price)}`;
}
function truncateSubject(s: string): string { return s.length > 78 ? s.slice(0, 75) + "..." : s; }

// apps/api/src/notify/notify-suppression.service.ts
@Injectable()
export class SuppressionService {
  constructor(private readonly db: DatabaseService) {}
  async isSuppressed(emailHash: string): Promise<boolean> {
    return !!(await this.db.suppressionList.findOne({ email_hash: emailHash }));
  }
  async addSuppression(emailHash: string, reason: "hard_bounce" | "complaint" | "manual", sourceEvent?: string): Promise<void> {
    try {
      await this.db.suppressionList.insertOne({ email_hash: emailHash, reason, addedAt: new Date(), sourceEvent });
    } catch (e: any) {
      if (e.code !== 11000) throw e;
    }
  }
}

// apps/api/src/notify/notify-webhook.controller.ts
@Controller("webhooks/resend")
export class NotifyWebhookController {
  constructor(
    private readonly db: DatabaseService,
    private readonly suppression: SuppressionService,
  ) {}

  @Post()
  async handle(@Headers("resend-signature") sig: string, @Body() body: any, @Req() req: any) {
    if (!verifyResendSignature(sig, req.rawBody, process.env.RESEND_WEBHOOK_SECRET!)) {
      throw new UnauthorizedException();
    }
    const eventId = body.data?.email_id ?? `${body.type}-${body.created_at}`;
    const existed = await this.db.webhookEvents.findOneAndUpdate(
      { eventId, source: "resend" },
      { $setOnInsert: { receivedAt: new Date(), type: body.type } },
      { upsert: true }
    );
    if (existed.value) return { received: true, duplicate: true };

    const type = body.type;
    const email = (body.data?.to ?? [])[0];
    const emailHash = email ? sha256(email.toLowerCase() + process.env.EMAIL_HASH_SALT).slice(0, 32) : null;

    switch (type) {
      case "email.delivered":
        await this.db.notifications.updateOne({ resendMessageId: body.data.email_id }, { $set: { deliveredAt: new Date() } });
        break;
      case "email.opened":
        await this.db.notifications.updateOne({ resendMessageId: body.data.email_id }, { $set: { openedAt: new Date() } });
        break;
      case "email.clicked":
        await this.db.notifications.updateOne({ resendMessageId: body.data.email_id }, { $set: { clickedAt: new Date() } });
        break;
      case "email.bounced":
        await this.db.notifications.updateOne({ resendMessageId: body.data.email_id }, { $set: { bouncedAt: new Date() } });
        if (body.data.bounce?.type === "hard" && emailHash) {
          const bounces = await this.db.notifications.countDocuments({
            resendMessageId: { $exists: true },
            bouncedAt: { $exists: true },
            userId: await this._findUserIdByEmailHash(emailHash),
          });
          if (bounces >= 2) await this.suppression.addSuppression(emailHash, "hard_bounce", body.data.email_id);
        }
        break;
      case "email.complained":
        if (emailHash) await this.suppression.addSuppression(emailHash, "complaint", body.data.email_id);
        break;
    }
    return { received: true };
  }
}

function verifyResendSignature(header: string, rawBody: Buffer, secret: string): boolean {
  // Resend format: "t=<unix>,v1=<hex>"
  const match = /t=(\d+),v1=([0-9a-f]+)/.exec(header ?? "");
  if (!match) return false;
  const [, timestamp, signature] = match;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // 5-min skew
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
```

---

## §7 — Dependencies

- FR-WATCH-002 (trigger eval populates `AlertJobData`)
- FR-AFF-002 (deeplink generation)
- FR-LEGAL-002 (`AFFILIATE_DISCLOSURE_VI` constant + ESLint rule)
- FR-WORKER-001 (BullMQ `alert-dispatch` queue)
- FR-OBS-001 (Sentry beforeSend PII redaction, PostHog event capture)
- Resend SDK + verified `cyberskill.world` DNS records (SPF/DKIM/DMARC)
- MongoDB TTL index on `notifications.sentAt` (365 days)
- Redis (deferred-job delay queue)

Migration:
```ts
await db.collection("notifications").createIndex({ idem: 1, channel: 1 }, { unique: true, name: "idem_channel_unique" });
await db.collection("notifications").createIndex({ userId: 1, sentAt: -1 }, { name: "user_sent_at" });
await db.collection("notifications").createIndex({ sentAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600, name: "ttl_365d" });
await db.collection("notifications").createIndex({ resendMessageId: 1 }, { sparse: true, name: "resend_msg" });
await db.collection("suppressionList").createIndex({ email_hash: 1 }, { unique: true });
await db.collection("webhookEvents").createIndex({ eventId: 1, source: 1 }, { unique: true });
```

---

## §8 — Example payloads

### Rendered email (abbreviated)

```
From: SaleNoti <alerts@cyberskill.world>
To: user@example.com
Subject: 🔥 Áo thun nam basic — 89.000 ₫
List-Unsubscribe: <https://sale.cyber.skill/unsubscribe?u=u1&watchlistId=w1&t=abc123>, <mailto:unsubscribe@cyberskill.world?subject=u-u1>
List-Unsubscribe-Post: List-Unsubscribe=One-Click

Áo thun nam basic
89.000 ₫ (giảm 31% từ 129.000 ₫)
Baseline khi bạn add: 99.000 ₫
Min 30 ngày: 85.000 ₫

[ Mua ngay trên Shopee → ] https://shope.ee/AbCdEf12

---
SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public,
chúng tôi nhận hoa hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không
trả thêm. Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác,
ẩn deal tốt hơn để hưởng commission cao hơn.

Hủy nhận alert sản phẩm này: https://sale.cyber.skill/unsubscribe?u=u1&watchlistId=w1&t=abc123
Quản lý alerts: https://sale.cyber.skill/dashboard
```

---

## §9 — Open questions (resolved)

**Q1: HTML + plaintext multipart?**
A: Resend handles automatic plaintext fallback from the React Email template.

**Q2: Per-trigger subject lines?**
A: P2 (A/B test framework). MVP uses the emoji-per-trigger pattern in §6 `formatSubject`.

**Q3: Inline image vs CDN URL?**
A: CDN URL (Shopee CDN, no asset costs, no Resend size limit pressure). Risk: hot-link could break — failure mode #11.

**Q4: Why not use Resend's React Email Audience for marketing/alert separation?**
A: Audience is opt-in marketing; alerts are transactional. Tagging with `fr: "FR-NOTIF-001"` is sufficient for Resend's analytics.

**Q5: Should we support custom unsubscribe reasons?**
A: P2. MVP unsubscribe is binary; the data is still in PostHog `notification_unsubscribed` event if we add a follow-up survey later.

**Q6: Domain warmup needed?**
A: Resend handles IP rotation automatically. We only need to verify DNS (SPF, DKIM, DMARC) on `cyberskill.world` before going live.

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Resend 5xx | SDK throws | exception in `process()` | BullMQ retries 3x with backoff; idem prevents double-send | warning |
| 2 | Idempotency key collision (genuine duplicate) | unique-index 11000 | catch in insertOne | noop; logged but not failed | info |
| 3 | Disclosure constant accidentally edited | snapshot test fails | CI gate blocks PR | revert + ESLint rule for "shopee"/"affiliate" outside disclosure | error |
| 4 | User unsubscribes via mailto link mid-batch | webhook update | future alerts skipped via `notificationChannels` flag | OK | info |
| 5 | Resend domain de-listed (sender rep) | bulk delivery failures | Sentry alert on >5% bounce rate | restore SPF/DKIM/DMARC; throttle send rate | error |
| 6 | Watchlist deleted before alert fires | wl lookup null | skip + audit log | acceptable | info |
| 7 | Deeplink generation fails (FR-AFF-002 down) | catch + fallback | use plain `product.url` (no commission, no broken email) | degraded but functional | warning |
| 8 | Daily cap hit but trigger urgent (flash_sale 1h) | cap check fires | deferred to tomorrow | P2 will bypass cap for `flash_sale`; MVP accepts the miss | warning |
| 9 | Resend rate-limit (per second) | SDK 429 | BullMQ retries with jitter | configure queue `limiter: { max: 10, duration: 1000 }` per FR-WORKER-001 | warning |
| 10 | Webhook spoofing (replay attack) | HMAC + 5-min skew window | reject 401 | per AC10 | warning |
| 11 | Shopee CDN image hot-link blocked | email image broken | client renders alt-text | accept (most clients have alt text working); proxy via our CDN P2 | info |
| 12 | User changes email after suppression | suppression keyed on hash | re-evaluation under new email_hash | accept (intentional re-validation) | info |
| 13 | TTL index purges row but resendMessageId arrives in late webhook | matched-update no-op | accept silent drop | TTL is 365d, well beyond Resend's 30-day webhook retention | info |
| 14 | Outlook clipping at 102KB | rendered HTML too large | enforce 100KB max post-render | minify HTML, lazy-images | warning |
| 15 | Sentry PII leak — email in error object | beforeSend hook | redacts to email_hash | AC16 verifies | error |
| 16 | List-Unsubscribe header strips on some MTAs | tested via Gmail/Apple/Outlook | both `mailto:` and HTTPS variants present | dual-variant header per RFC 8058 | info |

---

## §11 — Notes

- Alert subject line is the highest leverage CTR control. Keep iteration log in `docs/notif/subject-experiments.md` once A/B framework lands at P2.
- The `commissionRateAtTrack` on the watchlist (FR-WATCH-001) is what we report in transparency; we deliberately do NOT write `commissionRateAtAlert` because the rate at alert time is irrelevant for cohort analysis (the user opted in at track time).
- Resend's free tier 3K emails/month covers P1's 5K target only if we batch-defer carefully under cap. After 3K, $20/50K is dirt-cheap.
- The dual-write to `notifications` (DB) + Resend (provider) is intentionally Mongo-first: if Resend fails after DB insert, retry sees the idem row and skips — slight risk of "we said we sent but didn't" but recoverable via webhook reconciliation. The alternative (Resend-first then DB) leaves orphan emails on DB failure, which is worse.
- Per-channel idempotency means email/push/Telegram each compute their own key from the same job data with different salts. Cross-channel correlation goes through the shared `correlationId` field.
- The unsubscribe endpoint is unauthenticated (token-validated only) so users can unsubscribe even if their session is expired — RFC 8058 requires this for one-click compliance.
- The TTL index uses the same partial-key pattern as FR-LEGAL-001 PDPL retention; rows can be PII-purged via the `delete(purge)` flow without breaking the TTL semantics.

---

*FR-NOTIF-001 spec — last revised 2026-05-16. Status: accepted (10/10).*
