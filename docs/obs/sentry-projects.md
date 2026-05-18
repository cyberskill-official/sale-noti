# Sentry Projects

SaleNoti uses two Sentry projects so browser noise and API incidents can be triaged independently.

| Project | Runtime | DSN env | Required settings |
|---|---|---|---|
| `salenoti-web` | Next.js web, server, edge, browser | `SENTRY_DSN_WEB`, `NEXT_PUBLIC_SENTRY_DSN_WEB` | `tracesSampleRate=0.1`, `profilesSampleRate=0.05`, release from `GIT_COMMIT` |
| `salenoti-api` | NestJS API and workers | `SENTRY_DSN_API` | `tracesSampleRate=0.1`, `profilesSampleRate=0.05`, release from `GIT_COMMIT` |

Alert routing:

- P1 unhandled exception: immediate Slack `#oncall`.
- P1 security event: `kind in {reuse_detected, auth_breach, breach_signal}`.
- P2 spike: > 50 same fingerprint in one hour, daily batch.

All events must pass SDK-side PII redaction before leaving the process.
