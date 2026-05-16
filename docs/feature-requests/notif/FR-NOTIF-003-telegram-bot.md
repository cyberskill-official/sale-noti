---
id: FR-NOTIF-003
title: "Telegram bot — `/start <linkToken>` daily-rotated binding · per-user channel · shared idempotency with FR-NOTIF-001/002 · disclosure-on-every-message"
module: NOTIF
priority: MUST
status: accepted
verify: T
phase: P2
milestone: P2 · slice 1 · Growth & Monetization
slice: 1
owner: "Intern #2 (BE) supervised by Senior Tech Lead"
created: 2026-05-16
related_frs: [FR-NOTIF-001, FR-NOTIF-002, FR-AFF-002, FR-LEGAL-002, FR-AUTH-003]
depends_on: [FR-NOTIF-001]
blocks: []
effort_hours: 6

new_files:
  - apps/api/src/notify/notify-telegram.processor.ts
  - apps/api/src/notify/telegram-webhook.controller.ts
  - apps/web/src/app/api/me/telegram/link-token/route.ts
modified_files:
  - apps/api/src/notify/notify.module.ts
allowed_tools:
  - "file_read/write apps/api/**"
  - "file_read/write apps/web/**"
  - "bash pnpm test"
disallowed_tools:
  - "long-poll Telegram updates from a Railway pod (use webhook + queue worker pattern instead)"
  - "send Telegram messages without truncated disclosure paragraph (FR-LEGAL-002 §1 #4 binds every channel)"
  - "send PII to Telegram beyond what user explicitly consented to receive"
  - "expose `TELEGRAM_BOT_TOKEN` to any client-side code or log destination"
risk_if_skipped: "Plan §C7 explicit: 'Telegram bot integration (đề xuất bonus, không có trong plan trưởng nhóm — cực kỳ phù hợp VN)'. Vietnamese deal-hunter community lives on Telegram channels (plan §A2: 'Sàn Mã Giảm Giá Shopee Lazada Tiki 666K, Sàn Sale Shopee, Nghiện Shopee'). Web Push fails on iOS Safari non-PWA (~30% of VN active internet population); Telegram fills that gap. Without this channel, plan §I Phase 2 retention metric (D30 ≥ 35%) is at risk because iOS users churn without a reliable alert channel."

---

## §1 — Description (BCP-14 normative)

The notify service MUST add Telegram as a third alert channel, complete with bot lifecycle, webhook handler, and shared idempotency with email + push channels.

1. **MUST** register a Telegram Bot via `@BotFather` (one-time setup) and persist `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_NAME` (e.g., `SaleNotiBot`) in Doppler. Token MUST NEVER appear in client-side code, logs, or PostHog payloads.
2. **MUST** configure Telegram webhook to `https://api.salenoti.vn/webhooks/telegram?secret=<TELEGRAM_WEBHOOK_SECRET>` via Bot API `setWebhook` call (one-time setup script). Query-param secret is the cheap auth method recommended by Telegram for webhook handlers.
3. **MUST** expose `GET /v1/me/telegram/link-token` returning `{ token: string, deepLink: string, expiresIn: 86400 }`. Token format: `linkToken = sha256(userId + TELEGRAM_LINK_SALT + dayBucket).slice(0, 16)` where `dayBucket = floor(Date.now() / 86_400_000)`. Token rotates daily; valid 24h.
4. **MUST** handle `/start <linkToken>` message in webhook: verify token by reversing the day-bucket against `users` collection (try today's + yesterday's buckets to handle midnight-boundary race), look up the matching userId, then set `users.telegramChatId = chat.id` and `users.notificationChannels.telegram = true`. Reply with confirmation message including disclosure paragraph (FR-LEGAL-002 §1 #4, truncated).
5. **MUST** subscribe a BullMQ worker process to the `alert-dispatch` queue (parallel to email + push processors) using `@Processor("alert-dispatch", { name: "telegram" })` per `@nestjs/bullmq` syntax. Worker reads `users.telegramChatId`; skips if unset; uses the same `alertIdem` + `reserveSend` helpers as FR-NOTIF-001 §1 #3.
6. **MUST** send each alert via Telegram Bot API `POST /bot<TOKEN>/sendMessage` with body `{ chat_id, text, parse_mode: "HTML", disable_web_page_preview: false, reply_markup: { inline_keyboard: [[{ text: "Mua ngay →", url: <deeplink with utm=telegram&idem=...> }]] } }`.
7. **MUST** include the truncated disclosure paragraph in EVERY message text (not just first or onboarding). Truncated wording (150 chars):
   > "SaleNoti là price-tracker affiliate. Click → hoa hồng. Bạn không trả thêm. Đọc đầy đủ: salenoti.vn/legal/affiliate"
8. **MUST** support these commands in webhook handler: `/start <token>` (bind), `/start` (instructions if no token), `/help` (command list), `/status` (active watchlist count), `/unsubscribe` (clear chat ID + flip channel flag false). Unknown commands → silent ignore (Telegram bot convention).
9. **MUST** apply same idempotency key as FR-NOTIF-001 §1 #3 → single alert event = 1 message per channel (email + push + telegram). The `notifications` collection row has `channel: "telegram"` with unique `(idem, channel)` index preventing double-dispatch.
10. **MUST** rate-limit per Telegram chat at 30 messages/minute/chat per Telegram Bot API ceiling. Worker uses the queue's natural rate-limiter; bursts above 30/min get queued not dropped.
11. **MUST** emit PostHog events `telegram_linked`, `telegram_unlinked`, `telegram_message_sent`, `telegram_clicked` (last via inline-button URL `?utm=telegram&idem=...` reaching the share-click handler which records `clickedAt` on the `notifications` row).
12. **MUST** retain Telegram `message_id` + chat ID in `notifications` row for future moderation / DSR fulfillment (FR-LEGAL-001 §1 #6 right-to-erasure: user can `/unsubscribe` AND request deletion of historical message IDs via DPO request).
13. **MUST** handle user-blocked-bot case: when Telegram returns HTTP 403 on `sendMessage`, atomically clear `users.telegramChatId` AND set `users.notificationChannels.telegram = false`. User can re-bind via fresh `/start <new-token>` if they unblock later.
14. **MUST** validate `TELEGRAM_WEBHOOK_SECRET` on every webhook call. Missing or wrong → 403 silently. Telegram retries failed webhooks; 403 is a permanent stop signal.
15. **MUST** combined-cap with email + push: total ≤ 20/day/user across all three channels (per FR-NOTIF-001 §1 #10 `dailyCount()`).
16. **MUST NOT** echo user-supplied text from `/start` arg into the reply (HTML-injection defense). The arg is only the token; reply text is hardcoded.

---

## §2 — Why this design

**Why Telegram (vs Zalo or WhatsApp):** plan §C7 + §A2 explicit. Vietnamese deal-hunter community lives on Telegram channels (the listed groups in §A2 collectively have 666K+ members). Zalo Official Account requires Vietnamese business entity + per-session message pricing (~50K ₫/conversation = death at MVP scale). WhatsApp business API is similarly expensive + low penetration in VN deal-hunter cohorts (WhatsApp is for international family chat, not domestic deal discovery).

**Why webhook (not long-poll):** plan §C7 + scale considerations. Long-poll requires one always-on connection per process; doesn't scale horizontally across Railway pods. Webhook is HTTP-stateless and scales identically to any REST endpoint. Additionally, webhook latency (Telegram → our server) is typically < 200ms vs long-poll's 1-30s.

**Why daily-rotated link token:** the token appears in URLs and conversation history (e.g., user shares the link with a friend by accident). Daily rotation bounds replay risk: a stale token from yesterday won't work today. Token reversal scans both today's + yesterday's day-buckets to handle the midnight-boundary race (user clicks at 11:59 pm, message arrives at 12:01 am — both should succeed).

**Why disclosure in every message (not just bind):** FR-LEGAL-002 §1 #4 explicit; Telegram surface counts as "alert" channel. Users forwarding alerts to friends carry the disclosure inline; no follower can claim "I didn't know SaleNoti earns commission." The 150-char truncated form fits inside Telegram's typical message size constraints while preserving the three "DO NOT" commitments by reference.

**Why same idempotency key across email + push + telegram:** prevents triple-send across channels. User getting 3 messages (email + push + telegram) for the same trigger is alert spam; getting 1 per channel is the right behavior. Combined cap (§1 #15) layers on top: even if the user opts into all 3 channels, total ≤ 20/day.

**Why HTML parse_mode (not Markdown or MarkdownV2):** Telegram's HTML parser is the most predictable; MarkdownV2 requires escaping a long list of special chars (`_*[]()~>#+-=|{}.!`). HTML's escape surface is the standard `<, >, &, ", '` set which we already handle via the inline `escapeHtml` helper. Less escape-bug risk.

**Why `disable_web_page_preview: false`:** the deeplink in the inline button is a `shope.ee/...` URL; Telegram fetches the OG meta tags and shows a product preview card automatically. This is free UX upgrade — users see product image + title before they click.

**Why inline button `utm=telegram&idem=...`:** the click attribution beacon (analogous to the push beacon in FR-NOTIF-002 §1 #10) lets us write back `clickedAt` to the `notifications` row when the user clicks through. Without the idem in the URL, we couldn't join the click back to the specific alert.

**Why user-blocked-bot triggers channel flag flip:** if a user blocks the bot, every subsequent dispatch returns 403 from Telegram — without auto-cleanup we'd spin worker capacity sending to dead chats. Clearing `telegramChatId` + flipping the flag is the right "graceful give-up" UX; user can re-bind anytime.

**Why webhook secret in query param (not header):** Telegram's `setWebhook` API supports `secret_token` field that adds an `X-Telegram-Bot-Api-Secret-Token` header to every call, but query-param secret is also accepted and works through any proxy/CDN that strips custom headers (Vercel is one). Query-param is the robust choice.

---

## §3 — API contract

### GET link token

```http
GET /v1/me/telegram/link-token HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7...

→ 200 OK
{
  "ok": true,
  "token": "a3f9c2d1e7b8a4f5",
  "deepLink": "https://t.me/SaleNotiBot?start=a3f9c2d1e7b8a4f5",
  "expiresIn": 86400
}
```

### Telegram webhook (incoming from Telegram)

```http
POST /webhooks/telegram?secret=<TELEGRAM_WEBHOOK_SECRET> HTTP/1.1
{
  "update_id": 12345,
  "message": {
    "message_id": 678,
    "chat": { "id": 9876543210, "type": "private" },
    "from": { "id": 9876543210, "first_name": "Stephen" },
    "text": "/start a3f9c2d1e7b8a4f5",
    "date": 1700000000
  }
}

→ 200 OK
{ "ok": true }
```

### Outbound alert message (via Bot API)

```http
POST https://api.telegram.org/bot<TOKEN>/sendMessage HTTP/1.1
{
  "chat_id": 9876543210,
  "text": "🔥 <b>Áo thun nam basic</b>\nGiảm 31% — 89.000 ₫\n<i>SaleNoti là price-tracker affiliate. Click → hoa hồng. Bạn không trả thêm. Đọc đầy đủ: salenoti.vn/legal/affiliate</i>",
  "parse_mode": "HTML",
  "disable_web_page_preview": false,
  "reply_markup": {
    "inline_keyboard": [[{ "text": "Mua ngay →", "url": "https://shope.ee/AbCdEf?utm=telegram&idem=abc123" }]]
  }
}
```

---

## §4 — Acceptance criteria

1. `GET /v1/me/telegram/link-token` returns 16-char token + `https://t.me/SaleNotiBot?start=...` deep-link + `expiresIn: 86400`.
2. User sends `/start <valid-token>` to bot → webhook handler verifies + binds `users.telegramChatId`; replies with confirmation including disclosure paragraph.
3. User sends `/start <expired-token>` (>24h old) → reply "Link đã hết hạn".
4. User sends `/start <invalid-token>` → reply "Link đã hết hạn" (same surface as expired; defeats enumeration).
5. Webhook with wrong/missing `secret` query param → 403; no state change.
6. Worker dispatch on triggered alert with linked Telegram → message sent via Bot API with inline button.
7. Same alert event (idem) fires twice → exactly one Telegram message sent (shared idem with FR-NOTIF-001 unique-index).
8. `/unsubscribe` → channel flag flipped false; `telegramChatId` cleared; reply confirmation.
9. Disclosure paragraph (truncated 150 chars) present in EVERY message: linking confirmation, alert message, all command responses where bot speaks.
10. Inline button URL carries `?utm=telegram&idem=<idem>`; click triggers `/api/share/click` (or equivalent) → updates `notifications.clickedAt`.
11. 31 messages in 1 min to same chat → 31st queued (BullMQ rate-limiter), not dropped.
12. PostHog event includes `userIdHash` (12-char hex via FR-OBS-001 §1 #5 convention); chat ID NEVER in events.
13. p95 outbound message delivery < 500 ms (Telegram side latency dominates).
14. User blocks bot → next dispatch returns 403 → `telegramChatId` cleared + `notificationChannels.telegram = false`.
15. Combined cap with email + push: 19 emails + 1 push + 1 telegram queued → 21st alert deferred regardless of channel.
16. HTML injection attempt in `/start <html>` → reply uses hardcoded text only; no echo of user input.

---

## §5 — Verification

```ts
describe("FR-NOTIF-003 — Telegram bot", () => {
  it("AC1: link-token endpoint returns deepLink", async () => {
    const r = await api.get("/v1/me/telegram/link-token");
    expect(r.body.token).toMatch(/^[a-f0-9]{16}$/);
    expect(r.body.deepLink).toBe(`https://t.me/SaleNotiBot?start=${r.body.token}`);
    expect(r.body.expiresIn).toBe(86400);
  });

  it("AC2: /start <valid-token> binds chatId", async () => {
    const { token } = (await api.get("/v1/me/telegram/link-token")).body;
    await postTelegramWebhook({ message: { text: `/start ${token}`, chat: { id: 12345 } } });
    const user = await getUser(testUserId);
    expect(user.telegramChatId).toBe(12345);
    expect(user.notificationChannels.telegram).toBe(true);
  });

  it("AC4: invalid token gets same response as expired", async () => {
    const sent = await getRepliesSent();
    await postTelegramWebhook({ message: { text: "/start FAKEFAKEFAKEFAKE", chat: { id: 1 } } });
    const reply = sent[sent.length - 1];
    expect(reply.text).toContain("Link đã hết hạn");
  });

  it("AC5: wrong secret → 403", async () => {
    const r = await fetch("/webhooks/telegram?secret=wrong", { method: "POST", body: "{}" });
    expect(r.status).toBe(403);
  });

  it("AC7: idem shared with email/push — single send", async () => {
    const data = { userId: "u", watchlistId: "w", triggerKind: "pct_drop", observedAt: new Date("2026-05-16T11:00:00Z") };
    await alertDispatchQueue.add("a", data);
    await alertDispatchQueue.add("a", data);
    await waitJobs();
    expect(telegramSentCount()).toBe(1);
    expect(resendSentCount()).toBe(1);
  });

  it("AC9: disclosure paragraph present in alert message", async () => {
    await alertDispatchQueue.add("a", fixtureAlertJob);
    await waitJobs();
    expect(lastTelegramText()).toContain("SaleNoti là price-tracker affiliate");
    expect(lastTelegramText()).toContain("Đọc đầy đủ");
  });

  it("AC10: inline button URL carries utm+idem", async () => {
    await alertDispatchQueue.add("a", fixtureAlertJob);
    await waitJobs();
    const url = lastTelegramInlineButtonUrl();
    expect(url).toContain("utm=telegram");
    expect(url).toContain(`idem=${fixtureIdem}`);
  });

  it("AC12: PostHog event redacts chatId", async () => {
    const events = capturePostHog();
    await alertDispatchQueue.add("a", fixtureAlertJob);
    await waitJobs();
    const ev = events.find((e) => e.event === "telegram_message_sent");
    expect(JSON.stringify(ev)).not.toContain("12345");
    expect(ev!.properties.userIdHash).toMatch(/^[a-f0-9]{12}$/);
  });

  it("AC14: 403 (user blocked bot) clears chatId", async () => {
    mockTelegram403();
    await alertDispatchQueue.add("a", fixtureAlertJob);
    await waitJobs({ allowFailures: true });
    const user = await getUser(testUserId);
    expect(user.telegramChatId).toBeUndefined();
    expect(user.notificationChannels.telegram).toBe(false);
  });

  it("AC16: HTML injection in /start arg not echoed", async () => {
    await postTelegramWebhook({ message: { text: '/start <script>alert(1)</script>', chat: { id: 1 } } });
    const reply = (await getRepliesSent()).pop();
    expect(reply.text).not.toContain("<script>");
  });
});
```

---

## §6 — Implementation skeleton

See existing `notify-telegram.processor.ts` + `telegram-webhook.controller.ts` (already shipped). Inline notes:

```ts
function linkTokenFor(userId: string): string {
  const salt = process.env.TELEGRAM_LINK_SALT ?? "";
  const dayBucket = Math.floor(Date.now() / 86_400_000);
  return crypto.createHash("sha256").update(`${userId}|${salt}|${dayBucket}`).digest("hex").slice(0, 16);
}

// Reverse: check today + yesterday day buckets against all users.
async function userIdFromToken(token: string): Promise<string | null> {
  const salt = process.env.TELEGRAM_LINK_SALT ?? "";
  const buckets = [Math.floor(Date.now() / 86_400_000), Math.floor(Date.now() / 86_400_000) - 1];
  const users = await mongo.db("salenoti").collection("users").find({}, { projection: { _id: 1 } }).toArray();
  for (const u of users) {
    for (const b of buckets) {
      const expected = crypto.createHash("sha256").update(`${u._id}|${salt}|${b}`).digest("hex").slice(0, 16);
      if (expected === token) return String(u._id);
    }
  }
  return null;
}
```

Note on scale: the brute-force scan is acceptable at MVP (< 10K users). At 100K+ users, index `users.linkTokens` table or accept linear scan within day-bucket batches.

---

## §7 — Dependencies

- **External:** Telegram BotFather registration (one-time, ~5 min); `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_NAME` + `TELEGRAM_WEBHOOK_SECRET` + `TELEGRAM_LINK_SALT` in Doppler.
- **Internal:** FR-NOTIF-001 (idempotency helper, dailyCount cap, worker pattern), FR-AFF-002 (deeplink), FR-LEGAL-002 (disclosure).
- **Vendor:** `node:crypto`, `mongodb`, `posthog-node`. No Telegram SDK dependency — direct `fetch()` to Bot API.

---

## §8 — Example payloads

(see §3 — link token, webhook update, outbound sendMessage)

### Bind confirmation reply

```
✅ Đã liên kết. Bạn sẽ nhận alert giá trên Telegram.

Lệnh hữu ích:
/status — số sản phẩm đang theo dõi
/unsubscribe — tắt alert Telegram
/help — danh sách lệnh

SaleNoti là price-tracker affiliate. Click → hoa hồng. Bạn không trả thêm. Đọc đầy đủ: salenoti.vn/legal/affiliate
```

### Alert message

```
🔥 Áo thun nam basic
Giảm 31% — 89.000 ₫
SaleNoti là price-tracker affiliate. Click → hoa hồng. Bạn không trả thêm. Đọc đầy đủ: salenoti.vn/legal/affiliate

[ Mua ngay → ]  ← inline button
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Group bot vs DM-only?** Resolved → DM-only at P2. Groups in P3 (channel-level broadcasts to deal-hunter communities).
- **Q2: Channel messages (broadcast to subscribers)?** Resolved → P3 (lead-gen surface; out of scope for individual alerts).
- **Q3: Verify chat is human (not another bot)?** Resolved → Telegram is reasonably bot-proofed at registration; we accept.
- **Q4: Should the bot remember user preferences (channels, language)?** Resolved → no; preferences live in `users` Mongo doc, not in Telegram state. Telegram is dumb transport.
- **Q5: What if user wants to receive alerts in Telegram but unsubscribe from email?** Resolved → users.notificationChannels.email = false via dashboard; Telegram stays. Per-channel control.
- **Q6: Multi-language support (English bot replies)?** Resolved → P2 if data shows non-VN users; MVP is Vi-only.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| User blocks bot | sendMessage 403 | Clear `telegramChatId` + flip channel flag | AC14 |
| Token expired (>24h) | webhook handler check | Reply "Link hết hạn" | User refreshes via `GET /v1/me/telegram/link-token` |
| Rate-limit triggered (30/min/chat) | Telegram 429 response | BullMQ retries with backoff | Eventually delivers within minutes |
| Bot offline (webhook 5xx) | Telegram retries the update 5 min | Recovered when bot back | Acceptable |
| Idempotency miss (Redis disconnect) | unique-index on `(idem, channel)` catches | One send wins | AC7 |
| Group join attempt | webhook handler rejects (only `private` chat type) | Reply "Tôi chỉ hỗ trợ DM" | None |
| Disclosure truncated wrongly | snapshot test in CI on `lastTelegramText()` | PR blocked | Fix template |
| Webhook signature wrong | 403 silently | Reject; Telegram retries 5 min then drops | None |
| Daily rotation cron drift (clock skew) | bucket math threads tolerance via yesterday+today checks | OK | AC2 |
| Telegram API maintenance | regional outage | Queue accumulates; flushes on recovery | Telegram SLA |
| HTML injection in user input | hardcoded reply text; no echo | OK | AC16 |
| Token brute-force at scale | linear scan O(users × 2 days) — acceptable < 10K | Slow at 100K+ users | Add `users.linkTokens` index at P3 |
| Multiple users with same token (hash collision) | 16-char SHA-256 prefix ≈ 10^19 collision space | Impossible at MVP scale | None |
| User unsubscribes then re-binds with same chat ID | `findOneAndUpdate` sets new userId mapping | Latest wins (intended) | None |
| Inline button URL > 64 chars (Telegram limit per button text) | text capped at 12 chars; URL has no limit | OK | None |

---

## §11 — Notes

- The inline button URL carries `?utm=telegram&idem=<idem>` → click attribution flows back via the `/api/share/click` or `/api/me/telegram/clicked` handler (whichever is implemented). We know which Telegram message was clicked, by which user, at what time.
- The 150-char truncated disclosure is the policy-grade form; full version lives in the linking-confirmation reply (~280 chars) and on `/legal/affiliate`. Plan §A3 principle 2 ("disclosure đầy đủ trên mỗi điểm chạm") is satisfied by the link-out.
- The brute-force userIdFromToken scan is a known O(N) cost at MVP scale (< 10K users × 2 buckets = 20K SHA-256 ops per webhook call, ~10ms). At 100K users we'd add a `linkTokens` collection indexed by token. The current implementation is intentionally simple to keep the binding flow stateless on the user side.
- Plan §C7 caveat: "Tỷ lệ conversion rất thấp ở VN do user không quen luôn cài đặt" for Web Push — Telegram is the corrective channel where the user is already in the app.
- The user-blocks-bot path (§1 #13 / AC14) is deliberately silent (no Sentry alert on the 403). This is normal user behavior; logging it would just create noise.

---

*End of FR-NOTIF-003. Status: accepted (10/10). Last expanded: 2026-05-16.*
