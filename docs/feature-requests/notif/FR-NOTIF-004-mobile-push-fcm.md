---
id: FR-NOTIF-004
title: "Mobile push (FCM) — primary channel for mobile users"
module: NOTIF
priority: MUST
status: draft
verify: T
phase: P3
milestone: "P3 - slice 1 - Mobile push"
slice: 1
owner: "Senior Tech Lead + Intern #2 (BE) + Intern #1 (mobile)"
created: 2026-05-26
related_frs:
  - FR-WATCH-004
  - FR-NOTIF-001
  - FR-NOTIF-002
  - FR-NOTIF-003
  - FR-LEGAL-002
  - FR-OBS-001
depends_on:
  - FR-WATCH-004
  - FR-NOTIF-001
  - FR-NOTIF-002
  - FR-NOTIF-003
blocks: []
effort_hours: 14
template: engineering-spec@1
new_files:
  - apps/mobile/src/notifications.ts
  - apps/mobile/src/push.ts
  - apps/mobile/src/__tests__/push.spec.ts
  - apps/mobile/app.json
  - apps/api/src/notify/notify-mobile.processor.ts
  - apps/api/src/notify/mobile-push.ts
  - apps/api/src/notify/__tests__/notify-mobile.spec.ts
  - apps/web/src/app/api/me/mobile-push/subscribe/route.ts
  - apps/web/src/app/api/me/mobile-push/unsubscribe/route.ts
  - apps/web/src/app/api/me/mobile-push/clicked/route.ts
  - apps/web/src/app/api/me/mobile-push/push-routes.spec.ts
modified_files:
  - apps/mobile/App.tsx
  - apps/api/src/notify/notify.module.ts
  - apps/mobile/package.json
allowed_tools:
  - "file_read/write apps/api/**"
  - "file_read/write apps/web/**"
  - "file_read/write apps/mobile/**"
  - "bash pnpm test"
  - "bash pnpm --dir apps/mobile typecheck"
disallowed_tools:
  - "prompt for push permission on app load or before an explicit user tap"
  - "log raw push tokens or device identifiers to PostHog, Sentry, or console output"
  - "send notifications without storing and enforcing a shared daily cap across channels"
  - "skip token cleanup when the provider reports invalid/expired device credentials"
  - "bypass disclosure surfaces when the app opens from a push tap"
risk_if_skipped: "The mobile app would ship without a first-class re-engagement channel, forcing mobile users onto weaker email/web-push/Telegram paths and lowering the value of FR-WATCH-004. P3 would stop at 'mobile app exists' instead of 'mobile app can reliably wake the user back into the deal flow.'"
---

## §1 - Description (BCP-14 normative)

The platform MUST support native mobile push notifications as the primary alert channel for the Expo mobile app, with explicit opt-in UX, shared idempotency, and shared daily caps across all alert channels.

1. The mobile client MUST request notification permission only after the user taps an explicit "Enable mobile notifications" action in Settings. The app MUST NOT prompt on launch, on background resume, or during session hydration.
2. The mobile client MUST use the Expo mobile notification stack or an equivalent native push helper to obtain a platform push token after permission is granted. The helper MUST treat the token as opaque and MUST NEVER log the token, device ID, or provider response payload.
3. The app MUST expose a reusable push helper in `apps/mobile/src/push.ts` and `apps/mobile/src/notifications.ts` that can register, refresh, and clear the mobile push token without coupling the UI to provider details.
4. The backend MUST expose `POST /v1/me/mobile-push/subscribe` with body `{ token: string; platform: "android" | "ios"; deviceId?: string; appVersion?: string }`. The endpoint MUST validate input with a schema, rate-limit to 5 calls/min/user, and persist the token as an opaque mobile push credential.
5. The backend MUST store tokens in `users.mobilePushTokens[]` with at least `{ token, platform, deviceId, appVersion, addedAt, lastSeenAt }`. It MUST enforce a maximum of 5 devices per user using FIFO eviction by `addedAt` and MUST set `users.notificationChannels.mobilePush = true` whenever at least one valid token remains.
6. The backend MUST expose `POST /v1/me/mobile-push/unsubscribe` to remove a specific token/device or clear all mobile tokens for the current user. If no tokens remain, it MUST flip `users.notificationChannels.mobilePush = false`.
7. The notify service MUST add `@Processor("alert-dispatch", { name: "mobilePush" })` and dispatch mobile alerts only when `notificationChannels.mobilePush` is enabled and at least one token exists. The worker MUST reuse the same `alertIdem`, `reserveSend`, and `dailyCount` helpers used by FR-NOTIF-001/002/003.
8. The mobile push payload MUST include `title`, `body`, `data.url`, `data.idem`, and `tag` fields. The `data.url` MUST deep-link back into the mobile app (not the web app) and MUST carry `utm=mobilePush&idem=...` for attribution.
9. The mobile app MUST handle a notification open/tap event by navigating to the deep-linked screen and MUST emit a click beacon to `POST /v1/me/mobile-push/clicked` with the alert idempotency key so `notifications.clickedAt` can be updated.
10. The mobile push flow MUST share the combined daily cap of 20 alerts/day/user across email, web push, Telegram, and mobile push. A user cannot bypass the cap by enabling multiple channels.
11. The backend MUST remove expired or invalid tokens when the provider returns an invalid-credential signal, and MUST clear `notificationChannels.mobilePush` when the last token is removed.
12. The platform MUST emit PostHog events `mobile_push_sent` and `mobile_push_clicked`. Events MUST include counts and the idempotency tail, but MUST NOT include raw token strings or full device identifiers.
13. The mobile surface MUST render an in-app disclosure banner when the app opens from a push deep link, so the user sees the affiliate disclosure before they interact with the deal.
14. The implementation MUST remain compatible with the current Expo-managed mobile app and MUST not require a separate native app rewrite to register the first device token.

## §2 - Why this design

Mobile is now a first-class surface in SaleNoti, so the app needs a direct alert channel instead of relying on email or chat apps that compete for attention on the phone.

This FR keeps the mobile client simple: the app owns permission prompting and token acquisition, while the backend owns persistence, idempotency, rate limiting, and dispatch. That matches the existing notify architecture used by email, web push, and Telegram.

The token is intentionally opaque. The server should not care whether the token comes from Android FCM, iOS APNs, or an Expo-native helper as long as it can dispatch and invalidate the token consistently.

The cap and idempotency rules are shared with the existing alert pipeline on purpose. SaleNoti must present one alert event to the user, not four duplicated messages just because the user enabled multiple channels.

The disclosure requirement stays in scope because the mobile app is still an affiliate surface. The push notification can stay short, but the deep-linked screen must present the disclosure banner before any user action on the deal.

## §3 - API contract and code shape

### Mobile client helpers

- `apps/mobile/src/notifications.ts` — permission and token lifecycle helper.
- `apps/mobile/src/push.ts` — app-facing push registration and click-beacon helper.
- `apps/mobile/App.tsx` — Settings UI for enabling/disabling mobile push and showing status.

### Mobile push subscription

```http
POST /v1/me/mobile-push/subscribe HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7...
Content-Type: application/json

{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "android",
  "deviceId": "pixel-8-pro",
  "appVersion": "1.0.0"
}
```

Expected response:

```http
HTTP/1.1 200 OK
{
  "ok": true,
  "deviceCount": 2
}
```

### Mobile push unsubscribe

```http
POST /v1/me/mobile-push/unsubscribe HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7...
Content-Type: application/json

{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

### Mobile click beacon

```http
POST /v1/me/mobile-push/clicked HTTP/1.1
Content-Type: application/json

{ "idem": "abc123def456..." }
```

### Push payload

```json
{
  "title": "🔥 Áo thun nam basic",
  "body": "SaleNoti · Giảm 31% — 89.000 ₫",
  "data": {
    "url": "salenoti://watchlists/65f7...?utm=mobilePush&idem=abc123",
    "idem": "abc123def456..."
  },
  "tag": "abc123def456..."
}
```

### MongoDB `users.mobilePushTokens[]`

```ts
{
  token: string,
  platform: "android" | "ios",
  deviceId?: string,
  appVersion?: string,
  addedAt: Date,
  lastSeenAt: Date,
}
```

## §4 - Acceptance criteria

1. User taps "Enable mobile notifications" in Settings → permission prompt appears only after the tap → token is saved → `users.notificationChannels.mobilePush` becomes `true`.
2. A triggered alert for a user with a registered mobile token appears on the device within 5 seconds on Android in the happy path.
3. Tapping the notification deep-links into the app, emits the click beacon, and updates `notifications.clickedAt` for the matching idem.
4. A token that returns an invalid/expired credential signal is removed automatically, and `notificationChannels.mobilePush` flips to `false` when the last token is gone.
5. Registering a 6th device evicts the oldest token and keeps the token list capped at 5.
6. Combined cap works across all channels: 19 alerts already sent across email/push/Telegram/mobile push means the 20th is the last allowed alert for the day.
7. The app never prompts for push permission on startup, session hydration, or background resume.
8. PostHog events for mobile push contain counts and idempotency metadata but never contain the raw token or device identifier.
9. The mobile disclosure banner is visible after notification open and before any user action on the deal.
10. Android and iOS both use the same subscribe/unsubscribe API shape even if the native token source differs underneath.
11. The implementation stays within the current Expo-managed mobile app and does not require ejecting the app or splitting the repository into a separate native project.
12. Subscribe rate-limit: 6th token-registration call in a minute for the same user returns 429.

## §5 - Verification

```ts
describe("FR-NOTIF-004 — mobile push", () => {
  it("AC1: explicit tap registers token", async () => {
    const r = await api.post("/v1/me/mobile-push/subscribe", {
      token: "ExponentPushToken[test-token]",
      platform: "android",
      deviceId: "pixel-8-pro",
      appVersion: "1.0.0",
    });
    expect(r.status).toBe(200);
    const user = await getUser(testUserId);
    expect(user.notificationChannels.mobilePush).toBe(true);
    expect(user.mobilePushTokens).toHaveLength(1);
  });

  it("AC2: dispatch sends mobile alert", async () => {
    await alertDispatchQueue.add("mobile", fixtureAlertJob);
    await waitJobs();
    expect(lastMobilePushPayload().title).toMatch(/^🔥 /);
    expect(lastMobilePushPayload().tag).toBe(fixtureIdem);
  });

  it("AC3: tap beacon updates clickedAt", async () => {
    await api.post("/v1/me/mobile-push/clicked", { idem: fixtureIdem });
    const row = await getNotificationRow(fixtureIdem, "mobilePush");
    expect(row?.clickedAt).toBeDefined();
  });

  it("AC4: invalid token cleans up channel", async () => {
    mockMobilePushInvalidToken();
    await alertDispatchQueue.add("mobile", fixtureAlertJob);
    await waitJobs();
    const user = await getUser(testUserId);
    expect(user.notificationChannels.mobilePush).toBe(false);
  });

  it("AC5: 6th registration evicts oldest", async () => {
    for (let i = 0; i < 6; i++) {
      await api.post("/v1/me/mobile-push/subscribe", {
        token: `ExponentPushToken[token-${i}]`,
        platform: "android",
        deviceId: `device-${i}`,
      });
    }
    const user = await getUser(testUserId);
    expect(user.mobilePushTokens).toHaveLength(5);
    expect(user.mobilePushTokens.find((t) => t.deviceId === "device-0")).toBeUndefined();
  });

  it("AC6: shared cap spans all channels", async () => {
    await seedNotifications(testUserId, { channel: "email", count: 19 });
    await api.post("/v1/me/mobile-push/subscribe", { token: "ExponentPushToken[token-1]", platform: "android" });
    await alertDispatchQueue.add("mobile", fixtureAlertJob);
    await waitJobs();
    expect(lastMobilePushPayload()).toBeUndefined();
  });
});
```

## §6 - Notes

- This FR assumes the mobile app will remain on Expo-managed workflow for the initial P3 slice.
- Push token handling is opaque by design; the server should not depend on provider-specific token shapes beyond platform classification.
- The deep-link target can remain the same watchlist/product routes already used by the app.
- If a future native rewrite becomes necessary, this FR still preserves the same token-registration and dispatch contract.
