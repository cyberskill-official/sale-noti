---
id: FR-NOTIF-002
title: "Web Push (VAPID + service worker) — Chrome / Edge / Android primary; iOS Safari graceful fallback to email; shared idempotency with FR-NOTIF-001/003"
module: NOTIF
priority: SHOULD
status: done
shipped: 2026-05-17
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: "Intern #2 (BE) + Intern #1 (FE) supervised by Senior Tech Lead"
created: 2026-05-16
related_frs: [FR-NOTIF-001, FR-NOTIF-003, FR-WATCH-002, FR-AFF-002, FR-LEGAL-002]
depends_on: [FR-NOTIF-001]
blocks: [FR-GROW-003]
effort_hours: 5

new_files:
  - apps/api/src/notify/notify-push.processor.ts
  - apps/web/public/service-worker.js
  - apps/web/src/server/push/vapid-keys.ts
  - apps/web/src/app/api/me/push/subscribe/route.ts
  - apps/web/src/app/api/me/push/unsubscribe/route.ts
  - apps/web/src/app/api/me/push/clicked/route.ts
modified_files:
  - apps/web/src/app/layout.tsx
allowed_tools:
  - "file_read/write apps/web/**"
  - "file_read/write apps/api/**"
  - "bash pnpm test"
disallowed_tools:
  - "use VAPID keys with TTL < 24h (push subscription rejected by browsers)"
  - "send push without explicit user consent (Notification.permission must be 'granted')"
  - "prompt iOS Safari users on page load before they install as PWA (Notification API not available; silent fail)"
  - "auto-permission-prompt on page load (Chrome heuristic-blocks the page entirely)"
  - "log raw push subscription endpoint to PostHog (PII per browser instance)"
risk_if_skipped: "Plan §C7 lists Web Push as a needed channel. With email as the only primary in P1, retention suffers because alerts compete with inbox promotions/spam. Web Push hits the OS notification center directly with sub-second latency — the alert lands while the user is still 'in the moment' of deal-hunting. Conversion rate on push alerts is ~3-5× higher than email per industry benchmarks; for time-sensitive flash sales (FR-WATCH-002 `flash_sale` trigger) push is the only viable channel."
---

## §1 — Description (BCP-14 normative)

The platform MUST support Web Push notifications as a secondary delivery channel with strict opt-in UX and shared idempotency with the email channel (FR-NOTIF-001).

1. **MUST** generate a VAPID keypair via `web-push generate-vapid-keys` once and store `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` in Doppler. The public key is safe to ship to the client (used in `applicationServerKey` during subscription); the private key stays server-only. Keys rotated only on key compromise; rotation invalidates all existing subscriptions and forces re-prompt.
2. **MUST** serve `apps/web/public/service-worker.js` at `/service-worker.js` with `Cache-Control: no-store` (configured in `next.config.mjs` via `async headers()` or Vercel header rule). The service worker registers via `navigator.serviceWorker.register("/service-worker.js")` in client `layout.tsx`, gated behind `if ("serviceWorker" in navigator)` capability check.
3. **MUST** expose `POST /v1/me/push/subscribe` body `{ endpoint: string (URL), keys: { p256dh: string, auth: string } }`. Validates schema with zod; rejects malformed payloads with 400. Persists to `users.pushSubscriptions[]` with max 5 entries per user (FIFO eviction by `addedAt`). Sets `users.notificationChannels.webPush = true` as a side effect.
4. **MUST** detect iOS Safari (`/iPhone|iPad|iPod/i.test(navigator.userAgent)` AND `/Safari/i.test(navigator.userAgent)` AND `!("standalone" in navigator)` for non-PWA mode) client-side and NOT show the "Enable push" prompt. Render an email-channel-only UI variant instead. Server-side, `notifyOrchestrator` (FR-NOTIF-001 §1 #2) checks `users.pushSubscriptions.length === 0` AND iOS-UA hints stored at sign-up and routes to email-only.
5. **MUST** ask permission only AFTER the user clicks an explicit "Enable push notifications" button in dashboard settings. NOT on page load. This is the WCAG accessibility best-practice AND the Chrome auto-block heuristic (since 2020): pages that auto-prompt before user gesture get permanently blocked from prompting again. The button-gated pattern is the only sustainable UX.
6. **MUST** dispatch push from BullMQ `alert-dispatch` queue when channel `webPush` is enabled AND ≥ 1 subscription exists. Worker uses the same idempotency key as FR-NOTIF-001 §1 #3: `idem = sha256(userId|watchlistId|triggerKind|observedAt.toISOString())`. A single alert event → at most one email + one push + one Telegram delivery (never duplicates).
7. **MUST** include in push payload: `title: "🔥 <productName>"` (truncated to 60 chars), `body: "Giảm <pct>% — <formatVnd(currentPrice)> · Min 30d: <formatVnd(last30dMin)>"`, `icon: "/icon-192.png"`, `data: { url: <deeplink with utm=push&idem=...>, idem }`, `tag: <idem>` (OS-level dedup so re-send of same alert doesn't stack on the notification shade).
8. **MUST** handle expired/invalidated subscriptions: when `web-push.sendNotification` returns HTTP 410 Gone (subscription expired) or 404 Not Found (subscription invalidated), atomically remove that entry from `users.pushSubscriptions[]` via `$pull: { pushSubscriptions: { endpoint: <expired-endpoint> } }`. If `users.pushSubscriptions[]` becomes empty after pull, set `users.notificationChannels.webPush = false`.
9. **MUST** combine daily cap of 20 pushes/day/user with the email channel's cap — total combined alerts across email + push + telegram ≤ 20/day/user (per FR-NOTIF-001 §1 #10 `dailyCount()` shared helper).
10. **MUST** emit PostHog events `push_sent`, `push_clicked` (the latter from service worker `notificationclick` handler via `fetch("/api/me/push/clicked")` beacon with `keepalive: true`).
11. **MUST** track `Notification.permission` state client-side; if user revokes permission outside our UI (browser settings → site settings → block), our next API call surfaces the revocation via a client-side `navigator.permissions.query({ name: "notifications" })` check and flips `users.notificationChannels.webPush = false` via `POST /v1/me/push/unsubscribe`.
12. **MUST** rate-limit `POST /v1/me/push/subscribe` to 5 calls/min/userId (legitimate use is once-per-device; 5 covers re-prompting edge cases like incognito + private window). Excess returns 429.
13. **MUST NOT** push raw `endpoint` URL to PostHog events; only emit `device_count` (an integer) and `success_count` / `failure_count` (per dispatch).
14. **MUST** retry on 5xx response from the push provider (FCM / Mozilla / Microsoft) with exponential backoff per FR-WORKER-002 §3 `backoffMs`. Max 3 retries; thereafter drop the alert (the alert's idem prevents future retries from re-dispatching the same event).

---

## §2 — Why this design

**Why Web Push (not native APNs / FCM SDK):** plan §C7 explicit — Web Push works on Chrome + Edge + Firefox + Android Chrome AND iOS Safari 16.4+ for PWAs. Native APNs requires an iOS app (P3 mobile native scope, FR-WATCH-004). FCM via browser is Chrome-only. Web Push is the broadest browser-only path; we get ~70% of VN active internet population coverage on day one (per plan §C7's analysis of Chrome + Edge + Android Chrome share).

**Why explicit user opt-in via dashboard button:** Chrome auto-blocks auto-prompting pages since 2020 (and the block is permanent for the site domain). The "Enable push" button after sign-in is the only sustainable pattern. Plan §C7 framing: push is "secondary" — users who opt in are the engaged subset; pushing the prompt at the wrong moment loses that subset forever.

**Why iOS pragmatism (don't prompt where it won't work):** iOS 16.4+ supports Web Push **only for PWAs that the user has explicitly "Added to Home Screen"**. Per plan §C7 analysis, "Add to Home Screen" conversion rate is < 5% in Vietnam; prompting Safari users who haven't installed the PWA produces 0% notification rate AND a confusing "permission denied" UX. Better to hide the prompt entirely on iOS Safari non-PWA and let email be the primary channel. iOS PWA-installed users get the same Enable-push button.

**Why 5 subscriptions per user cap:** multi-device users (laptop + phone + work laptop = 3 typical; +2 for Chromebooks or partners' devices = 5 generous). Users on 6+ devices are a vanishingly small cohort; FIFO eviction by `addedAt` favors recent device usage which matches real-world ergonomics.

**Why combined daily cap (not per-channel cap):** alert spam from any channel is alert spam. A user getting 10 email + 10 push + 10 Telegram for the same trigger is the worst-case experience and the most common churn cause. Combining the cap aligns the user's mental model ("I get at most 20 alerts per day") with system behavior regardless of which channels are enabled.

**Why VAPID keys never rotated except on compromise:** VAPID is the cryptographic identity binding "this server is the same one the user originally subscribed to." Rotating invalidates every existing subscription (subscribers MUST re-prompt). Routine rotation kills user trust + retention. Compromise rotation is the only justifiable trigger.

**Why `tag: <idem>` for OS-level dedup:** if our worker re-dispatches the same alert (e.g., after a Redis disconnect that lost the inflight idem write), the OS receives two pushes with the same `tag`. Per Web Push spec, the OS shows only the most recent notification with a given tag — user sees one bubble, not two. This is the cheapest possible idem safety net even when our app-level idem fails.

**Why `notificationclick` → fetch beacon (not custom analytics URL pattern):** the beacon pattern with `keepalive: true` is the only way to track click-throughs reliably from inside a service worker (which has a different lifecycle than the page). The `idem` carried in `data` lets us write back to the `notifications` collection's `clickedAt` field for that specific alert.

**Why retry 3× on 5xx (not infinite):** push provider 5xx is typically transient (e.g., FCM rate limit). 3 retries with exponential backoff (30s, 60s, 120s = ~3.5 min total) covers most transient failures. Beyond that, the alert is stale enough that re-pushing is no longer the right UX (user has likely moved on). The idem prevents future re-dispatch of the same event regardless.

---

## §3 — API contract & code shape

### `POST /v1/me/push/subscribe`

```http
POST /v1/me/push/subscribe HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7...
Content-Type: application/json

{
  "endpoint": "https://fcm.googleapis.com/fcm/send/abcd...",
  "keys": { "p256dh": "BFb...", "auth": "tBHIt..." }
}
```

Response:

```http
HTTP/1.1 200 OK
{ "ok": true, "deviceCount": 2 }
```

### Service worker push payload (out of band; the OS shape)

```json
{
  "title": "🔥 Áo thun nam basic",
  "body": "Giảm 31% — 89.000 ₫ · Min 30d: 85.000 ₫",
  "icon": "/icon-192.png",
  "data": {
    "url": "https://shope.ee/AbCdEf?utm=push&idem=abc123",
    "idem": "abc123def456..."
  },
  "tag": "abc123def456..."
}
```

### MongoDB `users.pushSubscriptions[]`

```ts
{
  endpoint: string,
  keys: { p256dh: string, auth: string },
  addedAt: Date,
  // No FIFO position field — sort by addedAt at write time.
}
```

---

## §4 — Acceptance criteria

1. User clicks "Enable push notifications" → `Notification.requestPermission()` resolves to "granted" → `POST /v1/me/push/subscribe` returns 201 (or 200 with idempotent existing-row); `users.pushSubscriptions` length increments.
2. Worker dispatch on triggered alert → push appears in OS notification center within 5s on Chrome/Android.
3. iOS Safari non-PWA user → "Enable push" button hidden in UI; email-only path routed server-side.
4. iOS PWA-installed user → "Enable push" button shown; permission prompt fires per OS.
5. Push idempotency: same idem fired twice → OS shows only one notification (tag-based dedup).
6. Subscription returns 410 Gone → automatic removal from `pushSubscriptions[]`; empty array → `notificationChannels.webPush = false`.
7. Combined daily cap: user has 18 emails + 3 pushes today; 22nd alert → deferred regardless of channel.
8. Permission revoked client-side via browser settings → next API call surfaces the revocation; `users.notificationChannels.webPush = false`.
9. Click on push → `notificationclick` handler fires → fetch beacon to `/api/me/push/clicked` → `notifications` row's `clickedAt` updated.
10. Worker test: 5 subscriptions on user → 5 sends; 1 fails 410 → row removed; other 4 succeed.
11. p95 dispatch (single subscription) < 400 ms (web-push library timing).
12. 6th subscription endpoint → oldest by `addedAt` evicted; cap of 5 maintained.
13. PostHog events `push_sent`, `push_clicked` fire with `deviceCount`, `successCount`, `idem` (last 12 chars only); raw endpoint URL absent.
14. Subscribe rate-limit: 6th call/min/user → 429.
15. 5xx push response → 3 retries with exponential backoff; 4th attempt dropped; alert idem prevents future re-dispatch.

---

## §5 — Verification

```ts
describe("FR-NOTIF-002 — web push processor", () => {
  it("AC1: subscribe persists row, sets channel flag", async () => {
    const r = await api.post("/v1/me/push/subscribe", {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "BFb...", auth: "tBHIt..." },
    });
    expect(r.status).toBe(200);
    const user = await mongo.db("salenoti").collection("users").findOne({ _id: new ObjectId(testUserId) });
    expect(user?.pushSubscriptions).toHaveLength(1);
    expect(user?.notificationChannels?.webPush).toBe(true);
  });

  it("AC2: dispatch triggers OS notification", async () => {
    const observed = await waitForServiceWorkerMessages();
    await alertDispatchQueue.add("p", fixtureAlertJob);
    const messages = await observed;
    expect(messages).toHaveLength(1);
    expect(messages[0].title).toMatch(/^🔥 /);
  });

  it("AC5: same idem fires once at OS level", async () => {
    await alertDispatchQueue.add("p", fixtureAlertJob);
    await alertDispatchQueue.add("p", fixtureAlertJob);
    await waitJobs();
    const messages = await capturedServiceWorkerPushes();
    expect(messages.map((m) => m.tag)).toEqual([fixtureIdem]);
  });

  it("AC6: 410 Gone removes subscription", async () => {
    mockWebPush410();
    await alertDispatchQueue.add("p", fixtureAlertJob);
    await waitJobs();
    const user = await getUser(testUserId);
    expect(user.pushSubscriptions).toHaveLength(initialCount - 1);
  });

  it("AC7: combined daily cap across channels", async () => {
    await seedNotifications(testUserId, { channel: "email", count: 18 });
    await seedNotifications(testUserId, { channel: "webPush", count: 3 });
    await alertDispatchQueue.add("p", fixtureAlertJob);
    expect(await capturedServiceWorkerPushes()).toHaveLength(0);
  });

  it("AC8: revoked permission flips channel flag", async () => {
    mockNotificationPermission("denied");
    await api.post("/v1/me/push/unsubscribe", {});
    const user = await getUser(testUserId);
    expect(user.notificationChannels?.webPush).toBe(false);
  });

  it("AC9: click beacon updates clickedAt", async () => {
    await alertDispatchQueue.add("p", fixtureAlertJob);
    await waitJobs();
    await api.post("/api/me/push/clicked", { idem: fixtureIdem });
    const row = await mongo.db("salenoti").collection("notifications").findOne({ idem: fixtureIdem, channel: "webPush" });
    expect(row?.clickedAt).toBeDefined();
  });

  it("AC12: 6th subscription evicts oldest", async () => {
    for (let i = 0; i < 6; i++) await api.post("/v1/me/push/subscribe", { endpoint: `https://x/${i}`, keys: { p256dh: "p", auth: "a" } });
    const user = await getUser(testUserId);
    expect(user.pushSubscriptions).toHaveLength(5);
    expect(user.pushSubscriptions.find((s) => s.endpoint === "https://x/0")).toBeUndefined();
  });

  it("AC13: PostHog events redact endpoint", async () => {
    const events = capturePostHog();
    await alertDispatchQueue.add("p", fixtureAlertJob);
    await waitJobs();
    const ev = events.find((e) => e.event === "push_sent");
    expect(JSON.stringify(ev)).not.toContain("fcm.googleapis.com");
    expect(ev!.properties.deviceCount).toBeGreaterThanOrEqual(1);
  });

  it("AC14: subscribe rate limit", async () => {
    for (let i = 0; i < 5; i++) await api.post("/v1/me/push/subscribe", { endpoint: `https://x/${i}`, keys: { p256dh: "p", auth: "a" } });
    const r = await api.post("/v1/me/push/subscribe", { endpoint: "https://x/over", keys: { p256dh: "p", auth: "a" } });
    expect(r.status).toBe(429);
  });

  it("AC15: 5xx retries 3× then drops", async () => {
    mockWebPush5xx({ persistent: true });
    await alertDispatchQueue.add("p", fixtureAlertJob);
    await waitJobs({ allowFailures: true });
    expect(mockedSendCallCount()).toBe(3);
  });
});
```

---

## §6 — Implementation skeleton

(see existing `notify-push.processor.ts` — implementation in §3 of FR-NOTIF-001 ledger; the worker is in place.)

Subscriber route:

```ts
const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export async function POST(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const limit = await rateLimitFixed(`push:subscribe:${userId}`, 5, 60);
  if (!limit.ok) return Response.json({ ok: false, error: "rate_limit" }, { status: 429, headers: { "Retry-After": "60" } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "validation_failed" }, { status: 400 });
  const userOid = new ObjectId(userId);
  // Remove existing by endpoint (avoid dup) then push with FIFO eviction.
  await mongo.db("salenoti").collection("users").updateOne({ _id: userOid }, { $pull: { pushSubscriptions: { endpoint: parsed.data.endpoint } } });
  await mongo.db("salenoti").collection("users").updateOne(
    { _id: userOid },
    {
      $push: { pushSubscriptions: { $each: [{ ...parsed.data, addedAt: new Date() }], $slice: -5 } },
      $set: { "notificationChannels.webPush": true, updatedAt: new Date() },
    }
  );
  return Response.json({ ok: true });
}
```

---

## §7 — Dependencies

- **External:** VAPID keypair (`pnpm dlx web-push generate-vapid-keys`).
- **Internal:** FR-NOTIF-001 (idempotency helper, dailyCount cap, worker pattern), FR-AFF-002 (deeplink in payload).
- **Vendor:** `web-push@^3.x`, `posthog-node`, `mongodb`.

---

## §8 — Example payloads

(see §3)

### Click attribution beacon

```http
POST /api/me/push/clicked HTTP/1.1
Content-Type: application/json
{ "idem": "abc123def456789abcdef012345..." }

→ 200 OK
```

### `notifications` row after delivered + clicked

```json
{
  "userId": "65f7...",
  "watchlistId": "65f8...",
  "channel": "webPush",
  "idem": "abc123...",
  "sentAt": "2026-05-16T11:00:00Z",
  "deliveredAt": null,
  "clickedAt": "2026-05-16T11:00:42Z"
}
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: TTL on push?** Resolved → 24h (Notification API default in web-push library).
- **Q2: Action buttons in notification?** Resolved → P2 (Chrome supports actions[] array; broader browser test needed; service worker action handler is simple).
- **Q3: How to ack browser-level permission revocation?** Resolved → §1 #11 `navigator.permissions.query({ name: "notifications" })` polling on dashboard load + `/api/me/push/unsubscribe` on detect.
- **Q4: What if user has 5 valid + 1 expired subscription?** Resolved → §1 #8 410 handler removes the expired one; remaining 5 stay.
- **Q5: Cross-browser endpoint compatibility?** Resolved → `web-push` library handles FCM (Chrome / Android Chrome / Edge) + Mozilla autopush (Firefox) + WNS (Edge legacy) endpoints transparently. The endpoint URL pattern differs but the library abstracts.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Service worker fails to register | console error in client | Push features disabled gracefully; email-only path | Inspect SW; usually a HTTPS or scope issue |
| Subscription expired | 410 Gone from push provider | Auto-remove from `pushSubscriptions[]` | AC6 covers |
| User on 5 devices already, adds 6th | $slice: -5 evicts oldest | New device active; oldest by addedAt dropped | AC12 covers |
| Browser blocks notification permission heuristically (Chrome auto-block) | `Notification.permission` returns "denied" without prompt | Surface email-only mode in UI; can't re-prompt for the session | Document in support docs; user clears site data to reset |
| Push payload > 4 KB | web-push library throws | Truncate body field; log warning to OBS | Cap body length at 200 chars in render |
| Push fired but service worker not yet registered (cold install race) | rare race | Lost push; same as no SW | Retry on next alert event |
| iOS PWA installed but permission denied | `Notification.permission` "denied" | Email fallback | OK; user opt-in if they change mind |
| Combined cap miscounted (Redis atomic INCR race) | unlikely; atomic INCR | OK | Sanity test in CI |
| VAPID key rotation | Old subs invalidated | Re-prompt users; UI banner "Re-enable notifications" | Document in rotation runbook |
| PostHog proxy beacon dropped (e.g., browser closed) | analytics gap on click | Acceptable; click measured at next dashboard load if user lands via the deeplink | None |
| User on incognito subscribes then closes | subscription orphan | 410 on next push → auto-cleanup | AC6 |
| Cross-device sync confusion (user re-installs browser, gets new endpoint) | new subscription accepted via subscribe endpoint | OK; old one will 410 on next push | AC6 |
| Browser-vendor-specific 5xx (FCM during outage) | retry-3-then-drop | Alert lost; user gets email backup | AC15 |
| Service-worker controller change mid-flight | rare | next push uses new SW | None at MVP |
| User-clicked beacon doesn't fire (network drop during click) | rare | clickedAt not recorded | Acceptable; CTR slightly under-reported |

---

## §11 — Notes

- Plan §C7 Telegram bot fallback ("add Telegram bot as backup — rất phổ biến ở VN, đặc biệt cho sàn sale dùng nhiều") is FR-NOTIF-003. The three channels (email + push + telegram) form the full alert delivery layer.
- Web Push coverage in VN per plan §C7 is ~70% effective penetration after iOS gap. The remaining 30% (iOS non-PWA users) is the FR-NOTIF-003 Telegram bot's primary audience.
- The `tag: <idem>` OS-level dedup is the safety net even when our app-level idem fails — if anything in the dispatch pipeline misfires, the user sees at most one bubble per (userId, watchlistId, triggerKind, observedAt).
- VAPID keys are the trust anchor between our backend and the user's browser. Treat them like signing keys: stored in Doppler, rotated only on compromise, documented in the incident-response runbook.

---

*End of FR-NOTIF-002. Status: shipped (2026-05-17). Last expanded: 2026-05-16.*
