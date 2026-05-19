# FR-NOTIF-003 Audit Report

**FR:** Telegram bot alert channel  
**Audit date:** 2026-05-19  
**State:** shipped + mocked-dependency  
**Failure count:** 1 resolved coverage issue

## Audit Verdict

Telegram local contract validation passes for `/start <token>` binding, `/status`, `/unsubscribe`, `/help`, wrong webhook secret rejection, daily rotated link tokens, alert worker dispatch, disclosure-on-every-message, HTML escaping, idempotent notification rows, blocked-bot cleanup, and redacted Sentry/PostHog behavior.

Live Telegram delivery remains gated by bot token, webhook configuration, and a reachable API host.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Webhook auth | Wrong `secret` | 403 |
| Token binding | Today/yesterday bucket token | Sets `telegramChatId`, enables channel |
| Expired token | No matching user | Reply only, no link |
| Commands | `/start`, `/help`, `/status`, `/unsubscribe` | Covered |
| Dispatch | Missing token/user/channel/chat id/cap/reserve | No-op |
| Disclosure | Alert text | Includes truncated affiliate disclosure |
| XSS | Product name contains HTML | Escaped before Telegram HTML parse mode |
| Blocked bot | Telegram 403 | Clears chat id and channel flag |
| Provider error | Telegram 5xx | Captured with FR tag, no chat id leakage |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/notify/__tests__/telegram.spec.ts
Test Files  1 passed (1)
Tests       5 passed (5)
```

```text
$ pnpm --filter @salenoti/api exec vitest run ... --coverage --coverage.include=src/notify/notify-telegram.processor.ts --coverage.include=src/notify/telegram-webhook.controller.ts --coverage.reporter=text
notify-telegram.processor.ts     100% statements, 100% lines
telegram-webhook.controller.ts   96.29% statements, 96.29% lines
```

## Live Verification

Requires `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_LINK_SALT`, a public webhook URL, and a real Telegram chat for `/start` + delivery smoke.

