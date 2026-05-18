# SaleNoti Processor Register

**Owner:** DPO · **Review cadence:** quarterly and on every new processor.  
**Companion:** `DPIA-2026-05.md`, `cross-border-transfer-impact-assessment.md`.

| Processor | Role | Region | Data categories | Lawful basis / transfer basis | Retention applied |
|---|---|---|---|---|---|
| MongoDB Atlas | Primary operational database | Singapore | Users, watchlists, notifications, billing metadata, lead records | Consent + contract performance; Art. 25 cross-border notice | Per `retention-schedule.md` |
| Vercel | Web hosting and edge delivery | United States edge | IP, request metadata, cookies, public pages | Contract performance + legitimate interest; user notice | Platform logs minimized; no app PII in edge logs |
| Railway / API host | API and worker runtime | United States or configured region | Request metadata, queue jobs, operational logs | Contract performance + legitimate interest; user notice | Logs 30-90 days |
| Upstash Redis | Queue, cache, rate limit, idempotency | Singapore or configured region | Queue payload IDs, cache keys, rate buckets | Contract performance + legitimate interest | TTL-bound by key; BullMQ retention policy |
| Neon Postgres / TimescaleDB | Price history | Singapore | Product price observations, no user PII | Contract performance; mostly non-PII business data | Raw and aggregate retention per FR-PRICE-001 |
| Resend | Transactional email | United States | Email address, message metadata, delivery events | Contract performance and consent for transactional notices | Delivery logs 365 days in SaleNoti; provider per DPA |
| Google OAuth | Authentication provider | United States/global | OAuth subject, email, name, avatar | User consent + contract performance | Account linkage while user active |
| Sentry | Error monitoring | United States | Redacted traces, errors, environment metadata | Legitimate interest; PII redaction | 30-90 days, project settings |
| PostHog | Product analytics | United States | Hashed identifiers, event names, feature flags | Consent / legitimate interest with redaction | Aggregated analytics; no raw PII |
| Better Stack | Uptime and logs | EU/US depending workspace | Health checks, incident logs | Legitimate interest | 30-90 days |
| Slack | Ops alerts | United States | Redacted incident/lead metadata | Legitimate interest | Workspace retention policy |
| Shopee Affiliate Open API | Product, offer, and affiliate links | Singapore/Vietnam | Product IDs, subIds, affiliate click metadata; no raw user PII | User-initiated affiliate flow + disclosure | Provider reporting retention |
| Telegram Bot API | Optional alert channel | Telegram infrastructure | Telegram chat ID, message metadata | Explicit opt-in | Until unlink or account deletion |
| Stripe | Payment processor | United States/Ireland/global | Customer ID, checkout/session metadata, last4/brand from provider | Contract performance, tax/accounting | 7 years billing skeleton; PII nulled on erasure |
| VNPay | Payment processor | Vietnam | Payment transaction metadata | Contract performance, tax/accounting | 7 years billing skeleton |
| MoMo | Payment processor | Vietnam | Payment transaction metadata | Contract performance, tax/accounting | 7 years billing skeleton |

## Change Control

Any new processor or region change requires:

1. DPO review.
2. Update to this register.
3. Update to the cross-border transfer assessment when data leaves Vietnam.
4. DPIA addendum when a new data category or processor materially changes risk.
5. Pull-request sign-off by the DPO before production data is sent.
