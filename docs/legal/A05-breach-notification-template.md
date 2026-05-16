# Notification of Personal Data Breach to A05

**Pursuant to Article 33 of Nghị định 13/2023/NĐ-CP.**
**Filing window:** within 72 hours of breach detection.
**Filing target:** Cục An ninh mạng và Phòng chống tội phạm sử dụng công nghệ cao (A05), Bộ Công an.

> Use this template as the working document during an incident. Fill each placeholder before submission; do not transmit the placeholder version.

---

## Section A — Notification metadata

| Field | Value |
|---|---|
| Date of notification to A05 | [WITHIN 72H OF DETECTION] |
| Time of breach detection (ICT) | [ISO 8601 with timezone] |
| Estimated start of breach (if known) | [ISO 8601] |
| Tracking ID (internal) | [Sentry / Better Stack incident URL] |
| Submission method | [Email · physical mail · in-person at A05 office] |
| Submitting officer | Stephen Cheng (Trịnh Thái Anh), DPO |
| DPO contact for follow-up | legal@salenoti.vn · (+84) 906 878 091 |
| Controller | CYBERSKILL SOFTWARE SOLUTIONS CONSULTANCY AND DEVELOPMENT JOINT STOCK COMPANY |
| Controller address | 1st Floor, 207A Nguyen Van Thu Street, Tan Dinh Ward, HCMC |
| DUNS | 673219568 |
| Reference to DPIA | DPIA-2026-05 (filed [date]) |

## Section B — Nature of the breach

### B1. Type (tick all applicable)

- [ ] Unauthorised access by third party
- [ ] Unauthorised access by employee / contractor
- [ ] Accidental disclosure to wrong recipient
- [ ] Loss of physical media (laptop, drive, etc.)
- [ ] System compromise (malware, ransomware, etc.)
- [ ] Misconfigured access controls
- [ ] Phishing / social engineering
- [ ] Lost or stolen credential
- [ ] Sub-processor breach (specify)
- [ ] Other (specify)

### B2. Detection method

How was the breach detected?

- [ ] Internal monitoring (Sentry tag `kind: reuse_detected` → Slack alert)
- [ ] Internal monitoring (Atlas anomaly outbound)
- [ ] Resend bounce rate spike
- [ ] User report
- [ ] Third-party notification (specify)
- [ ] Routine audit
- [ ] Other (specify)

### B3. Brief description

[1-3 paragraph factual narrative of what happened, what was accessed, by whom, and over what time window. Avoid speculation; mark unknowns as "under investigation."]

## Section C — Data subjects and data affected

### C1. Data subjects

| Category | Approximate count | Notes |
|---|---:|---|
| Free-tier users | [N] | |
| Pro / Pro+ users | [N] | |
| B2B contacts | [N] | |
| Total unique subjects | [N] | |

### C2. Data categories affected (tick all applicable)

- [ ] Email address
- [ ] Display name
- [ ] OAuth provider IDs
- [ ] Watchlist contents (Shopee URLs tracked)
- [ ] Notification delivery history
- [ ] IP address (truncated to /24 in storage)
- [ ] User-Agent
- [ ] Push subscription endpoint + keys
- [ ] Telegram chat ID
- [ ] Payment gateway customer IDs
- [ ] Hashed analytics IDs
- [ ] Other (specify)

Explicitly NOT in scope (not collected): home address, DOB, government ID, financial account numbers, health data.

## Section D — Likely consequences for data subjects

[Per the data categories above, what is the realistic worst-case for the affected subjects? E.g., phishing, account-takeover attempts, social engineering, embarrassment if watchlist contents could be inferred, financial loss if payment IDs misused.]

## Section E — Mitigation taken

### E1. Immediate (within first 24h)

- [ ] Vector closed (specific action and timestamp)
- [ ] Compromised credentials rotated
- [ ] Refresh-token family revoked (all sessions invalidated)
- [ ] Affected users notified via email (per Section F)
- [ ] Public-relations statement prepared (if scope warrants)

### E2. Investigation status

- [ ] Forensic timeline reconstructed
- [ ] Root cause identified
- [ ] Sub-processor (if any) notified and coordinated

### E3. Preventive measures

[New controls or process changes to prevent recurrence. Examples: tighten Mongo RBAC, rotate sub-processor secrets quarterly instead of annually, add new Sentry alert rule.]

## Section F — Communication to data subjects

[Required under Art. 33 if breach poses high risk to subjects. Attach the email template + the date sent + count of recipients.]

| Field | Value |
|---|---|
| Communication required? | [Yes/No — per Art. 33 risk threshold] |
| Communication channel | Email (Resend transactional) |
| Date sent | [ISO 8601] |
| Recipient count | [N] |
| Communication text | [Attach as appendix] |
| Self-service mitigation surfaced | [E.g., "Please change password / re-link Telegram / sign out other devices."] |

## Section G — Cross-border implications

[If the breach involves data hosted outside Vietnam, list which recipient(s) were affected and reference `cross-border-transfer-impact-assessment.md`.]

## Section H — Lessons learned and changes to TOM

[Update to be reflected in the next DPIA re-assessment cycle. List any §5 TOM additions or removals.]

## Section I — Signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| DPO | Stephen Cheng (Trịnh Thái Anh) | _____________________ | 2026-05-XX |
| CEO | Stephen Cheng | _____________________ | 2026-05-XX |
| Outside counsel (if engaged) | _________________ | _____________________ | 2026-05-XX |

---

## Drill log

This template MUST pass a quarterly drill (per FR-LEGAL-001 AC10). Last drill: [date]. Result: [pass / fail].

---

*End of A05-breach-notification-template.md — keep this file pristine; copy to `docs/legal/incidents/INC-<id>-A05-notification.md` per incident.*
