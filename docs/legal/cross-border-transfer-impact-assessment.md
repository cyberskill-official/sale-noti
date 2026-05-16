# Cross-Border Transfer Impact Assessment — SaleNoti v1.0

**Pursuant to Nghị định 13/2023/NĐ-CP Article 25 (Chuyển dữ liệu cá nhân ra nước ngoài).**
**Companion to:** `DPIA-2026-05.md`. **Draft:** v0.1 — 2026-05-16. **Counsel review:** pending.

---

## 1. Lawful basis for cross-border transfer

Per Article 25(2), cross-border transfer of personal data of Vietnamese subjects requires:

1. **Consent of the data subject** (Article 25(2)(b)) — obtained at sign-up via the explicit Privacy Policy + Affiliate Disclosure checkbox (FR-LEGAL-001 §1 #9 + FR-LEGAL-002 §1 #3).
2. **OR adequate protection at the recipient** (Article 25(2)(a)) — for each recipient below, we document the adequacy basis (SOC 2 / ISO 27001 / contractual DPA).

We rely primarily on (1) + use (2) as defense-in-depth.

## 2. Recipient inventory

### 2.1 MongoDB Atlas (M0 → M10 during P0–P2)

| Field | Value |
|---|---|
| Vendor | MongoDB, Inc. |
| Headquarters | New York, NY, USA |
| Hosting region for SaleNoti | Singapore (`SG-1`, AWS ap-southeast-1) |
| Data categories transferred | Users, watchlists, products, notifications, refresh tokens, magic-link tokens, B2B leads |
| Encryption at rest | AES-256 (default) |
| Encryption in transit | TLS 1.2+ enforced |
| Certifications | SOC 2 Type II · ISO 27001:2022 · HIPAA-eligible · PCI DSS |
| Data Processing Agreement | https://www.mongodb.com/legal/data-processing-agreement (pre-execute) |
| Sub-processor list | https://www.mongodb.com/legal/subprocessors |
| Adequacy basis | SOC 2 Type II + contractual DPA |
| User-consent disclosed in Privacy Policy? | Yes — by vendor name + Singapore region |

### 2.2 Vercel

| Field | Value |
|---|---|
| Vendor | Vercel, Inc. |
| Headquarters | San Francisco, CA, USA |
| Hosting region | Edge global (US-East primary for compute) |
| Data categories transferred | Web requests (incl. session cookies), static assets, ISR cache |
| Encryption at rest | AES-256 |
| Encryption in transit | TLS 1.2+ |
| Certifications | SOC 2 Type II · ISO 27001 · GDPR-aligned |
| DPA | https://vercel.com/legal/dpa |
| Adequacy basis | SOC 2 Type II + contractual DPA |
| User-consent disclosed in Privacy Policy? | Yes |

### 2.3 Railway

| Field | Value |
|---|---|
| Vendor | Railway Corp. |
| Headquarters | San Francisco, CA, USA |
| Hosting region | US-West (us-west-2) for BE pods + workers |
| Data categories transferred | API request bodies, transient logs, BullMQ job payloads |
| Encryption at rest | Provider-default (AWS-backed) |
| Encryption in transit | TLS 1.2+ |
| Certifications | SOC 2 Type II in progress |
| DPA | https://railway.com/legal/dpa |
| Adequacy basis | SOC 2 (pending) + contractual DPA · monitored quarterly |
| User-consent disclosed in Privacy Policy? | Yes |

### 2.4 Resend

| Field | Value |
|---|---|
| Vendor | Resend Inc. |
| Headquarters | San Francisco, CA, USA |
| Hosting region | US-East |
| Data categories transferred | Email address, email body (transactional + alert) |
| Encryption | TLS 1.2+ |
| Certifications | SOC 2 Type II |
| DPA | https://resend.com/legal/dpa |
| Adequacy basis | SOC 2 Type II + contractual DPA |
| User-consent disclosed in Privacy Policy? | Yes |

### 2.5 PostHog Cloud

| Field | Value |
|---|---|
| Vendor | PostHog, Inc. |
| Headquarters | London, UK / San Francisco, CA |
| Hosting region | US-Cloud (or EU-Cloud — TBD per FR-OBS-001) |
| Data categories transferred | Hashed user ID (sha256 + salt, 16-char prefix), event names, event properties |
| Personal data status | After PII-redaction step in FR-OBS-001 §1 #5, distinctIds are non-reversible hashes |
| Encryption | TLS 1.2+ |
| Certifications | SOC 2 Type II · ISO 27001 |
| DPA | https://posthog.com/legal/dpa |
| Adequacy basis | SOC 2 + hashed PII (defense in depth) |
| User-consent disclosed in Privacy Policy? | Yes |

### 2.6 Sentry

| Field | Value |
|---|---|
| Vendor | Functional Software, Inc. (dba Sentry) |
| Headquarters | San Francisco, CA, USA |
| Hosting region | US |
| Data categories transferred | Error stack traces, breadcrumbs (sanitised), redacted user email (`event.user.email = "[redacted]"` via beforeSend) |
| Personal data status | Minimal — emails stripped in beforeSend hook (FR-OBS-001 §3) |
| Encryption | TLS 1.2+ |
| Certifications | SOC 2 Type II · ISO 27001 |
| DPA | https://sentry.io/legal/dpa/ |
| Adequacy basis | SOC 2 + beforeSend redaction |
| User-consent disclosed in Privacy Policy? | Yes |

### 2.7 Better Stack

| Field | Value |
|---|---|
| Vendor | Better Stack s. r. o. |
| Headquarters | Prague, Czech Republic (EU) |
| Hosting region | EU |
| Data categories transferred | Uptime check results (no PII) |
| Encryption | TLS 1.2+ |
| Certifications | GDPR-aligned · ISO 27001 |
| Adequacy basis | EU jurisdiction (GDPR-adequate) + no PII |
| User-consent disclosed in Privacy Policy? | Mentioned (no PII flows) |

### 2.8 Shopee Affiliate Open API

| Field | Value |
|---|---|
| Vendor | Sea Limited (Shopee) |
| Headquarters | Singapore |
| Data flow direction | Outbound from SaleNoti: app credentials + subIds (hashed user ID, watchlist hash, source, campaign) |
| Personal data flowing outbound | None directly — subIds are opaque hashes |
| Adequacy basis | Shopee VN ToS + Affiliate Marketing Solution Agreement |
| User-consent disclosed | Yes (Affiliate Disclosure pre-click interstitial) |

### 2.9 Stripe

| Field | Value |
|---|---|
| Vendor | Stripe, Inc. |
| Headquarters | San Francisco, CA / Dublin, Ireland |
| Hosting region | US + Ireland |
| Data categories transferred | Stripe customer ID + payment metadata; PAN never reaches SaleNoti backend (Stripe Elements / Checkout flow) |
| Encryption | TLS 1.2+ · PCI DSS Level 1 |
| Certifications | PCI DSS L1 · SOC 1, 2 · ISO 27001 |
| Adequacy basis | Industry-standard PCI scope offload + contractual DPA |
| User-consent disclosed | Yes |

### 2.10 VNPay

| Field | Value |
|---|---|
| Vendor | VNPAY-QR (Vietnam) |
| Headquarters | Hanoi, Vietnam |
| Data flow | Domestic only (no cross-border) |
| Adequacy basis | Vietnamese counterparty; Decree 13 fully applies |

### 2.11 MoMo

| Field | Value |
|---|---|
| Vendor | M_Service JSC (MoMo) |
| Headquarters | Ho Chi Minh City, Vietnam |
| Data flow | Domestic only (no cross-border) |
| Adequacy basis | Vietnamese counterparty; Decree 13 fully applies |

### 2.12 Telegram (Phase 2)

| Field | Value |
|---|---|
| Vendor | Telegram FZ-LLC |
| Headquarters | Dubai, UAE |
| Hosting region | Multi-region (Telegram-managed) |
| Data flow | Telegram chat ID + message body (alerts) |
| Personal data | Chat ID = pseudonymous; message body contains product + price + disclosure |
| Adequacy basis | User-initiated `/start` binding (active consent) + standard Telegram Bot API ToS |
| User-consent disclosed | Explicit Telegram opt-in flow (FR-NOTIF-003 §1 #4) |

## 3. Monitoring & re-assessment

### 3.1 Quarterly recipient audit

The DPO re-checks each row in Section 2 quarterly:

- Has the recipient lost or changed any certification?
- Has the hosting region changed?
- Has a new sub-processor been added that affects our data?
- Is the DPA URL still current?

Findings logged to `docs/legal/cross-border-audit-log.md` (TBD).

### 3.2 Migration triggers

A recipient migration MAY be triggered when ANY of:

- SOC 2 / ISO 27001 lapses or is downgraded.
- Hosting region changes to a non-adequate jurisdiction.
- User base or data volume exceeds the recipient's free tier such that data residency degrades.
- Plan §H Risk Matrix row activates ("Vercel/Railway burst").

Migration plan inventory:

- **MongoDB Atlas alternative:** Aiven for MongoDB (EU region available).
- **Vercel alternative:** Cloudflare Pages + Cloudflare Workers.
- **Railway alternative:** Render or Fly.io.
- **Resend alternative:** SendGrid or AWS SES.
- **PostHog Cloud alternative:** Self-hosted PostHog on Hetzner EU.

## 4. Disclosure to data subjects

The Privacy Policy (`privacy-policy-vi.md`) MUST enumerate the recipient list above by vendor name and country of hosting. Generic phrasing like "cloud service providers" is insufficient under Article 25(2)(b).

## 5. Signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| DPO | Stephen Cheng | _____________________ | 2026-05-XX |
| CEO | Stephen Cheng | _____________________ | 2026-05-XX |
| Counsel reviewer | (TBD) | _____________________ | 2026-05-XX |

---

*End of cross-border-transfer-impact-assessment.md*
