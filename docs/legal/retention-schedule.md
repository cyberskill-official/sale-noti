# SaleNoti Retention Schedule

**Owner:** DPO · **Review cadence:** annual DPIA review and every material processor/data-category change.

| Data category | Store | Retention | Deletion / purge behavior |
|---|---|---|---|
| User account profile | MongoDB `users` | While account exists | Soft-tombstone immediately on erasure request; hard-purge PII after 72h |
| User email | MongoDB `users`, Resend | While account exists | Null in SaleNoti on purge; provider suppression logs retained as required for abuse prevention |
| Refresh tokens | MongoDB `refresh_tokens` | 30 days active; revoked records 365 days | Revoke on erasure and purge raw token material |
| Magic-link tokens | MongoDB `magic_link_tokens` | 15 minutes active; expired cleanup | Delete on expiry or erasure |
| Watchlists | MongoDB `watchlists` | While account exists | Mark deleted on erasure; unlink from PII |
| Notifications | MongoDB `notifications` | 365 days | TTL/delete after 365 days; mark deferred on user deletion |
| Browser-extension event logs | MongoDB/PostHog | 90 days | TTL or aggregate only |
| Push subscriptions | MongoDB `push_subscriptions` | Until unsubscribe, permission revoke, or account erasure | Delete endpoint row immediately |
| Telegram chat linkage | MongoDB `telegram_links` / `users` | Until unlink or account erasure | Null chat ID and revoke tokens |
| Affiliate links | MongoDB `affiliate_links` | 730 days for transparency reporting | Retain non-PII subIds and aggregate commission; unlink user on purge where required |
| Price history | TimescaleDB `price_history` | 730 days raw/aggregate per FR-PRICE-001 | Non-PII business data retained for product analytics |
| Subscription billing | MongoDB `subscriptions` | 7 years | Retain accounting skeleton; null email/name/phone and provider customer PII on erasure |
| B2B leads | MongoDB `b2b_leads` | 2 years unless converted or erased | Email/phone encrypted; purge on request or stale-lead cleanup |
| DSR request logs | MongoDB `privacy_audit_log` | 3 years | Keep audit skeleton; no raw exported payload |
| Security/incident logs | Sentry/Slack/docs/legal/incidents | 730 days | Redact PII in incident documents; retain evidence for compliance |
| Cross-border assessment records | Git docs/legal | Life of service + 3 years | Immutable audit history through git |

## Erasure SLA

1. `T+0`: user calls delete-account; `users.deletedAt` set immediately.
2. `T+24h`: cancellation window closes; purge remains scheduled.
3. `T+72h`: hard-purge PII fields and revoke sessions/tokens.
4. Non-PII aggregate metrics may remain only if not re-identifiable.

## Exceptions

- Billing skeleton data is retained up to 7 years for Vietnamese accounting/tax obligations.
- Fraud/security audit records may retain hashed identifiers where necessary to prevent abuse.
- Legal incident records may retain minimal redacted evidence through the limitation period.
