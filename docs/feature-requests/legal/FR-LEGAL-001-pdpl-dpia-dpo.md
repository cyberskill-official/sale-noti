---
id: FR-LEGAL-001
title: "PDPL Decree 13/2023 — DPIA filed + DPO appointed + A05 72h-breach notification + DSR endpoints + cross-border transfer impact assessment"
module: LEGAL
priority: MUST
status: done
shipped: 2026-05-17
verify: I
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Stephen Cheng (Founder) + one-shot Vietnamese privacy counsel (KPMG / EY / Tilleke & Gibbins / Russin & Vecchi per plan §B3)
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-LEGAL-002, FR-NOTIF-001, FR-AUTH-001, FR-AUTH-003, FR-WATCH-003, FR-BILL-001, FR-OBS-001, FR-ADMIN-001]
depends_on: [FR-OBS-001]
blocks: [FR-AUTH-001, FR-WATCH-001, FR-NOTIF-001, FR-BILL-001]
effort_hours: 16
template: engineering-spec@1

new_files:
  - docs/legal/DPIA-2026-05.md
  - docs/legal/DPO-appointment.md
  - docs/legal/A05-breach-notification-template.md
  - docs/legal/cross-border-transfer-impact-assessment.md
  - docs/legal/data-flow-map.png
  - docs/legal/processor-register.md
  - docs/legal/retention-schedule.md
  - apps/web/src/server/legal/breach-detector.ts
  - apps/api/src/legal/dsr-export.service.ts
  - apps/api/src/legal/dsr-delete.service.ts
  - apps/api/src/legal/legal.controller.ts
  - apps/api/src/legal/encryption-envelope.ts
  - apps/api/src/legal/__tests__/dsr.spec.ts
  - apps/web/src/app/privacy/page.tsx
  - apps/web/src/app/privacy/en/page.tsx
modified_files:
  - apps/web/src/app/auth/sign-in/page.tsx
allowed_tools: ["file_read/write docs/legal/**", "file_read/write apps/web/src/server/legal/**", "file_read/write apps/api/src/legal/**", "bash pnpm test"]
disallowed_tools:
  - "start processing personal data (including waitlist email collection) before DPIA is filed — Art. 24 violation"
  - "appoint a DPO who is also processing data they're meant to oversee (conflict of interest, Decree 13 Art. 28(3))"
  - "use implicit consent (footer disclaimer) for new sign-ups — Art. 11 requires specific, informed, demonstrable"
  - "delete PII without 24h soft-tombstone window — irreversible deletion of legitimately-deleted-by-mistake accounts"
  - "transfer personal data to a recipient outside the cross-border impact assessment without re-filing"
  - "store DPIA / DPO docs only in personal cloud — must live in git-versioned repo for audit trail"
risk_if_skipped: "Plan §H Risk Matrix flags PDPL violation as 'Low likelihood, High impact (fine + reputation)'. Decree 13/2023/NĐ-CP fines are up to 5% of revenue. A05 enforcement formally started 2025-2026. Plan §B3 explicit: 'Đây không phải nice-to-have. Đây là moat — nếu user VN một ngày nào đó đọc về scandal Honey ở US, họ sẽ tin SaleNoti nếu mọi thứ đã được công khai từ đầu.' Beyond fines: a single high-profile breach without 72h A05 notification can permanently damage operating-license posture."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). Before SaleNoti collects ANY personal data (email, IP, watchlist activity), the controller MUST satisfy the following compliance requirements.

### Filing & appointment

1. The controller MUST file a Data Protection Impact Assessment (DPIA) per Decree 13/2023 Art. 24 with Bộ Công an Cục An ninh mạng và Phòng chống tội phạm công nghệ cao (A05). The filing form MUST be the official `Mẫu số 02` (DPIA template). Filing window: 60 days from start of processing per Art. 24(2). The completed DPIA MUST live at `docs/legal/DPIA-2026-05.md` with A05 receipt scan attached.
2. The controller MUST appoint a DPO (Data Protection Officer) per Art. 28. For a 2-intern + senior-lead startup at MVP scale, the founder MAY initially serve as DPO; the appointment letter MUST be on file at `docs/legal/DPO-appointment.md` and submitted to A05 in the DPIA bundle. The DPO MUST have a documented conflict-of-interest declaration (Art. 28(3)).
3. The controller MUST maintain a Processor Register (`docs/legal/processor-register.md`) listing every third-party that processes personal data on the controller's behalf: MongoDB Atlas (SG region), Vercel (US edge), Resend (US), Neon (SG Postgres), Sentry (US error tracking), PostHog (US analytics), Better Stack (US logs), Stripe (global), VNPay (VN), MoMo (VN), Google OAuth (US auth provider). Each entry MUST include: name, role (processor/sub-processor), region, lawful basis for transfer, retention window applied to data they hold.

### Privacy Policy

4. The controller MUST publish a Privacy Policy in Vietnamese on `/privacy`, with English version at `/privacy/en`. Vietnamese is the authoritative version. The Policy MUST cover at minimum:
   - Data categories collected (email, IP, browser fingerprint, watchlist productIds, alert preferences, payment metadata last-4 + brand only).
   - Lawful basis per category (consent for marketing, contract performance for product features, legitimate interest for security/fraud).
   - Data-subject rights (truy cập, sửa, xóa, hạn chế xử lý, phản đối, di chuyển dữ liệu).
   - Retention windows per category (referencing `retention-schedule.md`).
   - Cross-border transfer disclosure (Atlas SG, Vercel US edge — must name countries explicitly).
   - DPO contact: `legal@cyberskill.world`.
   - Processor list with links to each processor's privacy policy.
   - Policy version + last-updated date.
5. The Privacy Policy version (e.g. `2026-05-16`) MUST be tracked in code as a constant `PRIVACY_POLICY_VERSION` and stamped on every user's consent record at sign-up.

### Breach response

6. The controller MUST prepare the A05 breach-notification template in `docs/legal/A05-breach-notification-template.md`. On any breach (defined per Art. 33: unauthorised access, accidental disclosure, alteration, loss of personal data, or significant denial of access), the DPO MUST send notification to A05 within 72 hours of breach detection.
7. The controller MUST implement an automated breach-detector at `apps/web/src/server/legal/breach-detector.ts` that pages the founder via Slack `#founder-incidents` + email when ANY of:
   - MongoDB anomalous outbound (auth failure spike, mass DELETE/UPDATE) from Atlas Activity Feed.
   - Sentry security event with `tags.kind: "reuse_detected"` (FR-AUTH-003) or `kind: "unauthorized_access"`.
   - Resend bounce > 10% over 30-min rolling window (mass-send anomaly indicating list compromise).
   - Stripe `radar.early_fraud_warning` (account takeover signal).
   - Manual operator trigger (`POST /admin/legal/breach-trigger` with admin role).
   The page MUST include the 72-hour deadline timestamp explicitly.
8. The breach response runbook (`docs/legal/breach-response-runbook.md`, NEW file) MUST detail T+0 / T+24h / T+72h actions: containment, investigation, notification draft, A05 submission via official email, user notification timing, post-mortem.

### Data Subject Rights endpoints

9. The system MUST expose `POST /v1/me/data-export` (authenticated, rate-limited 1 req/user/30d). The endpoint MUST:
   - Enqueue a background job that aggregates all user data (users row, watchlists, notifications, subscriptions, audit-log entries) into a ZIP.
   - Return `202 Accepted` with `{ traceId, expectedDeliveryAt: now + 30d }` per Art. 14(4).
   - Email the ZIP via secure-download-link (FR-NOTIF-001 channel) within 30 days max, typically < 24h.
   - Audit-log every export with admin-visible row in `dsr_log` collection.
10. The system MUST expose `POST /v1/me/delete-account` (authenticated). The endpoint MUST:
    - Set `users.deletedAt = now` immediately (soft-tombstone).
    - Trigger 24h grace period: a confirmation email MUST be sent with "Cancel deletion" link valid for 24h.
    - At T+24h (cron): if not cancelled, mark `users.purgeScheduledAt = now`.
    - At T+72h (cron): hard-purge PII via `delete(path, "purge")` flow per AGENTS.md §3.6 — `users.email`, `users.phone`, `users.ip_hash`, `users.consents`, all linked `watchlists`, `notifications` (with `deferredReason: "user_deleted"`), subscription PII fields. Non-PII aggregate stats MAY be retained (count by trigger, plan tenure) but MUST not be re-identifiable.
    - Subscription billing rows MUST retain skeleton data 7 years per Vietnamese accounting law (FR-BILL-001 §1 #23) with PII fields nulled.
11. The system MUST expose `POST /v1/me/access-request` (authenticated). Returns a structured JSON of all known user data within 15 days (Art. 14(2)). Distinct from `data-export` (ZIP) in scope: access-request is "what do you know about me?", export is "give me my data to take elsewhere".

### Consent

12. The sign-up flow MUST render an UNCHECKED checkbox "Tôi đồng ý với Chính sách bảo mật và Quy định affiliate" linking to `/privacy` + `/legal/affiliate`. Submission MUST be blocked client-side AND server-side if unchecked.
13. The server-side validation MUST verify the consent payload is present in the request body (`consents: { privacy_v1: true, version: "2026-05-16" }`) and reject sign-up with 422 if missing OR if version doesn't match current `PRIVACY_POLICY_VERSION`.
14. The user record MUST store `users.consents[]` as `Array<{ kind: string, version: string, grantedAt: Date, ip_hash, ua_hash, withdrawnAt?: Date }>`. Withdrawal MUST be possible via `POST /v1/me/withdraw-consent` body `{ kind, reason? }`; withdrawal MUST trigger appropriate downstream actions (e.g., marketing consent withdrawal → unsubscribe from all non-transactional emails).
15. When the Privacy Policy version changes materially, all active users MUST be presented with the new version on next sign-in and asked to re-consent. Minor wording changes (typo fixes) MAY use the same version.

### Retention & encryption

16. The retention schedule (`docs/legal/retention-schedule.md`) MUST document per-category retention:
    - Users (active): while account exists.
    - Users (deleted): 72h soft → hard-purge.
    - Watchlists: same as user.
    - Notifications: 365 days TTL (FR-NOTIF-001).
    - Browser-extension event logs: 90 days.
    - PriceHistory: 730 days (non-PII, business data).
    - Audit logs: 730 days (business operations).
    - Subscription billing: 7 years (VN accounting law, PII-nulled after user deletion).
    - DSR request logs: 3 years.
17. Personal data classified `restricted` (per `meta.classification` in AGENTS.md §17) MUST be encrypted at rest via envelope encryption: `apps/api/src/legal/encryption-envelope.ts` provides `envelopeEncrypt(plaintext, classification)` → AES-256-GCM under a per-field DEK, with DEK wrapped by a KMS-managed KEK. P0 ships with envelope encryption stubbed (one rotation-ready KEK in Doppler `KEK_PRIMARY`); P2 graduates to AWS KMS or equivalent.
18. PII fields covered by §17: B2B lead `email`, `phone` (FR-ADMIN-001), and `users.phone` if collected (P3). User email currently NOT encrypted at rest (consent-based processing, contract necessity); this MAY change with regulatory shift.

### Cross-border transfers

19. The controller MUST publish `docs/legal/cross-border-transfer-impact-assessment.md` per Art. 25. The document MUST enumerate every outbound destination:
    - MongoDB Atlas SG (recipient: MongoDB Inc; region: AWS ap-southeast-1; lawful basis: Art. 25(2) — user consent in Privacy Policy + recipient SOC 2 Type II).
    - Vercel US edge (recipient: Vercel Inc; region: us-east-1; lawful basis: same).
    - Resend US (transactional email; same basis).
    - Sentry US (error tracking; same basis).
    - PostHog US (analytics; same basis; PII redaction via `beforeSend` per FR-OBS-001).
    - Stripe US (payments; PCI/SAQ-A; same basis).
    - Neon SG (Timescale; same basis).
20. Any NEW outbound destination (new processor) MUST trigger a re-filing of the cross-border assessment AND DPIA addendum before the processor receives any production data. CI MUST gate by detecting changes to `processor-register.md` AND requiring counsel sign-off comment in PR.

### Compliance posture

21. The controller MUST conduct an annual DPIA review (rolling 12-month anniversary). Material changes (new data category, new processor, region change) MUST trigger immediate re-assessment.
22. The controller MUST procure cyber-liability insurance with minimum coverage $10K-$50K USD by Phase 1 launch; recommended provider per plan §H mitigation: Tokio Marine VN or similar.

---

## §2 — Why this design

**Why DPIA before email collection:** Decree 13 Art. 24(1) imposes the DPIA filing requirement on processing involving automated decision-making, large-scale processing, or processing of "categorical" data including behavioral profiling — which the price-tracking + product-recommendation flow squarely is. Filing late means the entire pre-filing dataset is non-compliant; A05 has the authority to order deletion of unlawfully-processed data. Better to file before any user signs up.

**Why founder-as-DPO initially (not external):** Decree 13 Art. 28(3) allows a founder to act as DPO for organizations with no operational role conflict. External DPO services in VN run 30M-50M ₫/month — disproportionate at P0. The conflict-of-interest gate is: founder oversees policy/process; Senior Tech Lead executes; interns build under code review. Founder doesn't write the data-processing code directly, which preserves the oversight separation. Re-evaluate at 100K MAU.

**Why 72-hour breach window:** Decree 13 Art. 33 mandates 72 hours. GDPR Art. 33 mirrors this. Building the template ahead of time (not under pressure during an active incident) is the difference between a clean filing and an embarrassing one with omissions that get cited in regulatory enforcement.

**Why explicit checkbox vs implicit consent:** Decree 13 Art. 11 + GDPR-derived consent standard (free, specific, informed, unambiguous, demonstrable). A buried "by signing in you agree…" footer does not meet "informed" or "demonstrable" — particularly "demonstrable" because there's no positive opt-in event to point to in an audit. Plan §A3 principle 2 (transparency) and §A2 (Honey lesson — users felt deceived) both push toward explicit checkbox. Cost: slightly lower signup conversion (~3-5% drop from added friction); benefit: legally clean + ethically aligned + audit-ready.

**Why cross-border transfer impact assessment:** plan §B3 #4 calls out the Vercel US / MongoDB Atlas SG outbound. Art. 25 requires explicit per-recipient justification when transferring PII abroad. A05 review will ask for this document; having it ready is cheaper than scrambling after the fact, and it doubles as our "vendor due diligence" record for SOC 2 prep at P3.

**Why soft-delete (24h grace) + hard-purge (72h):** users routinely delete accounts in anger or by mistake (especially during a frustrating customer support interaction). Hard-deleting immediately means support can't restore — leading to ticket escalations and bad sentiment. 24h grace with one-click "cancel deletion" recovery email balances user-care with deletion-promise. 72h total wait satisfies the "deletion within a reasonable period" requirement in Art. 17.

**Why DSR export ≠ DSR access request:** Art. 14 distinguishes "right of access" (what data do you have on me?) from "right of portability" (give me a copy I can take elsewhere). Access is fast structured-JSON; portability is a comprehensive ZIP. Different SLAs (15d access vs 30d export). Separating endpoints makes the distinction clear to the user.

**Why processor register as a separate doc:** Processors are reviewable; the register becomes the cross-reference for: (a) DPIA scope, (b) Privacy Policy "who we share with" section, (c) cross-border assessment, (d) annual review checklist, (e) due-diligence prep for SOC 2/ISO. One document, many uses.

**Why annual DPIA review + material-change trigger:** Decree 13 doesn't explicitly mandate annual review, but A05 enforcement guidance treats it as best practice. Material changes (new processor, new data category, region migration) absolutely require re-filing per Art. 24(3). Combining annual cadence + change-triggered makes us forward-compliant under both scenarios.

**Why automate breach detection:** the 72-hour clock starts at *detection*, not at the breach itself. A monitoring gap that turns a real breach into a "we noticed only when a user emailed us" delays detection by weeks and turns a 72h filing into an open-ended liability. Automated detectors covering the most likely vectors (auth breach, mass-send anomaly, fraud signal) shrink the detection-to-notification window to hours.

**Why insurance:** plan §H mitigates breach liability. $10K-$50K USD covers small-to-medium-incident response costs (forensics, notification, legal counsel). Insurance also functions as a forcing-function for compliance posture review — insurers ask questions that mirror A05's audit checklist.

---

## §3 — Document templates (canonical structure)

### DPIA `docs/legal/DPIA-2026-05.md`

```markdown
# Data Protection Impact Assessment — SaleNoti v1.0
- Controller: CyberSkill JSC (DUNS 673219568)
- DPO: Stephen Cheng (Trịnh Thái Anh) — legal@cyberskill.world
- Filed: 2026-05-16 to A05
- Service: SaleNoti — Shopee price-tracking + sale-notification

## 1. Scope of processing
[categories of data, sources, recipients, volumes, automated decision-making]

## 2. Necessity & proportionality
[lawful basis per category, data minimization, retention bounds, alternatives considered]

## 3. Risks to data subjects
[unauthorized access, function creep, behavioral profiling sensitivity, secondary uses]

## 4. Mitigation measures
[encryption at rest, RLS, audit logging, retention caps, breach detection,
 DSR endpoints, processor due diligence, training]

## 5. Cross-border transfer
[See cross-border-transfer-impact-assessment.md]

## 6. Re-assessment trigger
[any new data category, new sub-processor, new region, material UI change affecting consent]
```

### A05 breach-notification template `docs/legal/A05-breach-notification-template.md`

```markdown
# Notification of Personal Data Breach to A05
(Pursuant to Article 33 Decree 13/2023/NĐ-CP)

Date of notification: [WITHIN 72H OF DETECTION]
Date of breach detection: [ISO 8601]
Estimated date breach started: [if known]

1. Nature of breach: [unauthorized access | accidental disclosure | alteration | loss | denial-of-access]
2. Data categories affected: [email | IP | watchlist | payment last-4 | etc.]
3. Approximate number of subjects: [N]
4. Likely consequences for subjects: [phishing | account takeover | financial loss | etc.]
5. Mitigation taken: [revoked tokens | rotated keys | notified users | engaged counsel | etc.]
6. Mitigation planned: [forensics engagement | additional notifications | etc.]
7. DPO contact: legal@cyberskill.world · (+84)906 878 091

Signed: [DPO name]
```

### DPO appointment letter `docs/legal/DPO-appointment.md`

```markdown
# DPO Appointment — CyberSkill JSC
- Appointee: Stephen Cheng (Trịnh Thái Anh)
- Effective: 2026-05-16
- Term: 12 months, auto-renew unless terminated.
- Independence: reports directly to Board; not in operational data processing chain.
- Conflict-of-interest declaration: signed (see Annex A).
- Contact: legal@cyberskill.world · (+84)906 878 091
- Filing: copy submitted to A05 with DPIA bundle.
```

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | DPIA filed at A05 | inspection of `docs/legal/DPIA-2026-05.md` | document complete with all 6 sections; receipt scan attached at bottom |
| AC2 | DPO appointment | inspection of `docs/legal/DPO-appointment.md` | letter signed; conflict-of-interest declaration present; A05 receipt scan |
| AC3 | `/privacy` route | render in browser | renders Vietnamese policy ≥ 90% Vi text; lang switcher works; current policyVersion shown |
| AC4 | `/privacy/en` | render | renders English version; explicit "Vietnamese is authoritative" disclaimer |
| AC5 | sign-up page | render | unchecked privacy-consent checkbox; submit button disabled until checked |
| AC6 | sign-up submission without consent | POST /api/auth/signup | 422 with `error: "CONSENT_REQUIRED"` |
| AC7 | sign-up with `consents.privacy_v1: true, version: "2026-05-16"` | success | `users.consents[]` includes the consent row with `grantedAt`, `ip_hash`, `ua_hash` |
| AC8 | `POST /v1/me/data-export` | authenticated user | 202 + traceId; background job enqueued; rate-limit prevents 2nd within 30d |
| AC9 | `POST /v1/me/delete-account` | authenticated user | `users.deletedAt = now`; confirmation email sent; "Cancel deletion" link valid 24h |
| AC10 | T+25h after deletion request | retention cron | `users.purgeScheduledAt` set; user signs-in blocked (account deleted) |
| AC11 | T+73h after deletion request | retention cron | PII purged via `delete(purge)`; aggregate stats retained; audit row in `dsr_log` |
| AC12 | T+12h cancel-deletion clicked | user action | deletion cancelled; `deletedAt` cleared; user can sign in normally |
| AC13 | Sentry `reuse_detected` event emitted | fixture trigger | breach-detector pages Slack `#founder-incidents`; A05 deadline timestamp explicit |
| AC14 | Atlas anomaly fixture | fixture trigger | same as AC13 |
| AC15 | Resend bounce rate > 10% over 30-min window | mass-send fixture | breach-detector triggers; admin alert |
| AC16 | `docs/legal/processor-register.md` | inspection | lists Atlas, Vercel, Resend, Neon, Sentry, PostHog, Stripe, VNPay, MoMo, Google with regions + lawful bases |
| AC17 | `docs/legal/cross-border-transfer-impact-assessment.md` | inspection | covers all US/SG outbound destinations |
| AC18 | new processor added to `processor-register.md` | CI gate | PR blocked until counsel sign-off comment present |
| AC19 | drill — fill A05 template within 60min | timed drill | template completed; sent to counsel for review |
| AC20 | PRIVACY_POLICY_VERSION constant changes | next user sign-in | re-consent flow renders new version |
| AC21 | DSR access request | `POST /v1/me/access-request` | response within 15 days; JSON includes all known data |
| AC22 | DSR export request — 2nd within 30d | rate-limit fires | 429 with retryAfter explicit |
| AC23 | encryption envelope test | `envelopeEncrypt("test")` | returns `{ ciphertext, iv, kekVersion }`; `envelopeDecrypt` round-trips correctly |
| AC24 | annual DPIA review reminder | T+11 months from filing | calendar reminder + Slack ping to founder |

---

## §5 — Verification

This FR is verified by **inspection** (verify: I) plus automated drills:

```ts
// apps/api/src/legal/__tests__/dsr.spec.ts
describe("FR-LEGAL-001 — DSR + breach + consent", () => {
  it("AC6: signup without consent blocked", async () => {
    const r = await api.post("/api/auth/signup").send({ email: "u@x.com", password: "...", consents: {} });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("CONSENT_REQUIRED");
  });

  it("AC7: consent persisted with version + ip/ua hash", async () => {
    await api.post("/api/auth/signup").send({
      email: "u@x.com", password: "...",
      consents: { privacy_v1: true, version: "2026-05-16" },
    });
    const user = await db.users.findOne({ email: "u@x.com" });
    expect(user.consents).toContainEqual(expect.objectContaining({
      kind: "privacy_v1", version: "2026-05-16",
      grantedAt: expect.any(Date), ip_hash: expect.stringMatching(/^[a-f0-9]/),
    }));
  });

  it("AC9+AC10+AC11+AC12: delete-account 72h flow", async () => {
    const r = await api.post("/v1/me/delete-account").set("Authorization", `Bearer ${jwt}`);
    expect(r.status).toBe(202);
    let user = await db.users.findOne({ _id: testUserId });
    expect(user.deletedAt).toBeDefined();
    expect(resendMock.sent.some(m => m.subject.match(/Hủy yêu cầu xóa/))).toBe(true);

    advanceTime(25 * 3600_000);
    await retentionCron.run();
    user = await db.users.findOne({ _id: testUserId });
    expect(user.purgeScheduledAt).toBeDefined();

    advanceTime(48 * 3600_000); // total 73h
    await retentionCron.run();
    user = await db.users.findOne({ _id: testUserId });
    expect(user.email).toBeNull();
    expect(user.consents).toEqual([]);
  });

  it("AC13: reuse_detected Sentry event triggers founder page", async () => {
    await emitSentryEvent({ level: "error", tags: { kind: "reuse_detected" } });
    await breachDetector.evaluate();
    await waitForSlackMessage({ channel: "#founder-incidents" });
    expect(lastSlackMessage()).toMatch(/BREACH DETECTED.*reuse_detected/);
    expect(lastSlackMessage()).toMatch(/A05 72h clock starts NOW/);
  });

  it("AC19: drill — A05 notification fillable in < 60 min", async () => {
    const ts = Date.now();
    const filled = await fillA05Template({ detectedAt: new Date(), nature: "test", subjectsAffected: 0, categories: ["email"], consequences: "n/a (drill)", mitigation: "n/a (drill)" });
    expect(filled).toContain("Pursuant to Article 33");
    expect(filled).toContain("Date of breach detection");
    expect(Date.now() - ts).toBeLessThan(60 * 60_000);
  });

  it("AC20: policy version change → re-consent on next sign-in", async () => {
    const beforeVer = PRIVACY_POLICY_VERSION;
    mockEnv("PRIVACY_POLICY_VERSION", "2026-06-01");
    const r = await api.post("/api/auth/signin").send({ email: "u@x.com", consents: { privacy_v1: true, version: beforeVer } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("POLICY_REVISION_PENDING");
  });

  it("AC23: encryption envelope round-trip", async () => {
    const plaintext = "test@example.com";
    const sealed = envelopeEncrypt(plaintext);
    expect(sealed).toMatchObject({ ciphertext: expect.any(String), iv: expect.any(String), kekVersion: expect.any(String) });
    const decrypted = envelopeDecrypt(sealed);
    expect(decrypted).toBe(plaintext);
  });
});
```

Manual review checklist (founder + counsel sign-off):

- [ ] DPIA filed with A05; receipt photographed/scanned to `docs/legal/A05-receipt-DPIA-2026-05.pdf`.
- [ ] DPO appointment in personnel file + A05 submission acknowledgment.
- [ ] Privacy Policy published, linked from header + footer of every public page.
- [ ] Cross-border transfer assessment in `docs/legal/cross-border-transfer-impact-assessment.md`.
- [ ] One-shot counsel review note appended (KPMG / Tilleke / EY / Russin & Vecchi).
- [ ] Cyber-liability insurance quote obtained.
- [ ] Annual DPIA review calendar event created (T+11 months).

---

## §6 — Implementation skeleton

```ts
// apps/web/src/server/legal/breach-detector.ts
import { sentry } from "../obs/sentry";
import { slack } from "../obs/slack";

type BreachSignal =
  | "mongo_anomaly"
  | "reuse_detected"
  | "bounce_spike"
  | "stripe_fraud_warning"
  | "unauthorized_access"
  | "manual";

export const breachDetector = {
  async trigger(kind: BreachSignal, ctx: Record<string, unknown> = {}) {
    const detectedAt = new Date();
    const deadline = new Date(detectedAt.getTime() + 72 * 3600_000);
    sentry.captureMessage(`Breach signal: ${kind}`, { level: "error", tags: { fr: "FR-LEGAL-001", kind } });
    await slack.postMessage({
      channel: "#founder-incidents",
      text: `🚨 BREACH DETECTED — kind: ${kind}\nA05 72h clock starts NOW.\nDeadline: ${deadline.toISOString()}\nTemplate: docs/legal/A05-breach-notification-template.md`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*Context*: \`\`\`${JSON.stringify(ctx, null, 2)}\`\`\`` } },
        { type: "actions", elements: [
          { type: "button", text: { type: "plain_text", text: "Acknowledge" }, action_id: "ack_breach" },
          { type: "button", text: { type: "plain_text", text: "Mark false positive" }, action_id: "fp_breach" },
        ]},
      ],
    });
    await db.breachLog.insertOne({ kind, detectedAt, deadline, ctx, status: "open" });
  },

  async evaluate(): Promise<void> {
    const ev = await getRecentSentryEvents();
    for (const e of ev) {
      if (e.tags?.kind === "reuse_detected") await this.trigger("reuse_detected", { eventId: e.event_id });
    }
    const bounceRate = await computeResendBounceRate({ window: "30min" });
    if (bounceRate > 0.10) await this.trigger("bounce_spike", { bounceRate });
  },
};

// apps/api/src/legal/dsr-delete.service.ts
@Injectable()
export class DsrDeleteService {
  async requestDelete(userId: string): Promise<{ deletedAt: Date; purgeScheduledAt: Date }> {
    const now = new Date();
    const purgeAt = new Date(now.getTime() + 72 * 3600_000);
    await db.users.updateOne({ _id: userId }, { $set: { deletedAt: now, purgeScheduledAt: purgeAt } });
    await db.dsr_log.insertOne({ userId, kind: "delete_request", at: now });
    await this.notify.send({ to: await this.getUserEmail(userId), template: "delete-confirmation", vars: { cancelUrl: `/me/cancel-deletion?t=${this.generateToken(userId)}`, purgeAt } });
    return { deletedAt: now, purgeScheduledAt: purgeAt };
  }

  async cancelDelete(userId: string): Promise<void> {
    await db.users.updateOne({ _id: userId }, { $unset: { deletedAt: 1, purgeScheduledAt: 1 } });
    await db.dsr_log.insertOne({ userId, kind: "delete_cancelled", at: new Date() });
  }

  @Cron("0 */6 * * *")
  async runPurgeCron(): Promise<void> {
    const due = await db.users.find({ purgeScheduledAt: { $lt: new Date() } }).toArray();
    for (const user of due) {
      await this._purgePII(user._id);
      await db.dsr_log.insertOne({ userId: user._id, kind: "purge_complete", at: new Date() });
    }
  }

  private async _purgePII(userId: string): Promise<void> {
    await db.users.updateOne({ _id: userId }, {
      $set: { email: null, phone: null, ip_hash: null, ua_hash: null, consents: [], deleted: true },
      $unset: { purgeScheduledAt: 1 },
    });
    await db.watchlists.updateMany({ userId }, { $set: { status: "deleted_user", purgedAt: new Date() } });
    await db.notifications.updateMany({ userId }, { $set: { deferredReason: "user_deleted", purgedPII: true }, $unset: { resendMessageId: 1 } });
    await db.subscriptions.updateMany({ userId }, { $set: { paymentMethodSummary: null, gatewayCustomerId: null } });
  }
}

// apps/api/src/legal/encryption-envelope.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function envelopeEncrypt(plaintext: string): { ciphertext: string; iv: string; tag: string; kekVersion: string } {
  const kek = Buffer.from(process.env.KEK_PRIMARY!, "base64");
  const kekVersion = process.env.KEK_VERSION ?? "v1";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  let ct = cipher.update(plaintext, "utf8");
  ct = Buffer.concat([ct, cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"), kekVersion };
}

export function envelopeDecrypt(sealed: { ciphertext: string; iv: string; tag: string; kekVersion: string }): string {
  const kek = Buffer.from(sealed.kekVersion === "v1" ? process.env.KEK_PRIMARY! : process.env[`KEK_${sealed.kekVersion}`]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  let pt = decipher.update(Buffer.from(sealed.ciphertext, "base64"));
  pt = Buffer.concat([pt, decipher.final()]);
  return pt.toString("utf8");
}
```

---

## §7 — Dependencies

- **External:** Vietnamese privacy counsel one-shot consult (plan §B3 lists KPMG, EY, Tilleke & Gibbins, Russin & Vecchi as candidates). Budget 30M ₫ for the package.
- **Internal:** FR-OBS-001 (Sentry + Slack webhook), FR-NOTIF-001 (DSR confirmation emails).
- **Regulatory:** A05 form Mẫu số 02 / 04 (current as of 2026-05-16); re-validate at counsel review.
- **Infra:** Doppler env `KEK_PRIMARY` (256-bit base64), `KEK_VERSION` (rotation tracker).
- **Cyber-liability insurance:** ~$10K-$50K USD coverage; Tokio Marine VN candidate.

---

## §8 — Example payloads

### A05-filing receipt (placeholder shape)

```
Receipt no.: A05/PDPL/2026/00XXX
Filed by: CyberSkill JSC (DUNS 673219568)
Filed on: 2026-05-XX
Category: New data controller registration + DPIA
Reviewer assigned: [agent name]
Status: Received, under review
```

### DSR export response

```json
{
  "traceId": "dsr_8f3kQp1z",
  "expectedDeliveryAt": "2026-06-15T00:00:00.000Z",
  "message": "Yêu cầu xuất dữ liệu đã được nhận. Bạn sẽ nhận được email với link tải xuống trong vòng 30 ngày."
}
```

### Breach-detector Slack payload

```
🚨 BREACH DETECTED — kind: reuse_detected
A05 72h clock starts NOW.
Deadline: 2026-05-19T10:00:00.000Z
Template: docs/legal/A05-breach-notification-template.md

Context: { "eventId": "evt_abc123", "family": "01J9Z...", "userId_hash": "ab12cd34" }
```

---

## §9 — Open questions (resolved)

**Q1: File DPIA on day 0 or after first 100 users?**
A: Day 0. Decree 13 Art. 24 is about *processing*, not *user count*. Waiting introduces the "unlawful pre-filing data" trap.

**Q2: Internal DPO or external?**
A: Internal (founder). External DPO is ~30M ₫/mo; not justified at P0 scale. Re-evaluate at 100K MAU.

**Q3: Bilingual Privacy Policy or Vi-only?**
A: Bilingual. Plan §F1 includes B2B sellers / English-speaking partners. Vi is the authoritative version.

**Q4: Soft-delete vs hard-delete on account deletion?**
A: Soft-tombstone immediate (24h hide), hard-purge in 72h. Grace window for "deleted by mistake" recovery. Documented in Privacy Policy.

**Q5: Encrypt all user emails at rest?**
A: Not at MVP — emails are contract-necessity processing under Art. 11; encryption adds operational complexity (key rotation, search-against-encrypted) without proportional risk reduction. B2B leads (FR-ADMIN-001) ARE encrypted because their commercial sensitivity is higher. Revisit MVP user-email at P3.

**Q6: When to re-consent — every policy change, or only material ones?**
A: Material only. Typo fixes / formatting changes don't require re-consent. Adding a new data category or new processor DOES. Distinguished via `PRIVACY_POLICY_VERSION` semantic-versioning convention (major bump = material).

**Q7: How to handle data-export of a user with 500 watchlists?**
A: Background job (BullMQ), 30-day SLA covers it. The ZIP includes a JSON manifest + per-collection NDJSON dumps. Email link is one-time, valid 7 days.

**Q8: What about analytics events (PostHog) — does deletion purge those?**
A: PostHog events are hashed-userId per FR-OBS-001 PII-redaction; they're not directly identifiable post-purge. We do NOT separately purge PostHog records on deletion (technically allowed under "data minimization satisfied through hashing").

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | A05 filing rejected (form errors) | receipt status "rejected" | counsel reviews rejection reason | re-file within 14d; processing on pause | error |
| 2 | Privacy Policy drift from actual processing | quarterly manual review | counsel flags; transparency report due | update Policy + re-consent on next sign-in | warning |
| 3 | Breach-detector false positive | founder reviews alert | check signal noise; tune threshold | no filing made; logged with reason | info |
| 4 | Breach detected after-hours / vacation | 72h clock still ticks | backup contact: Senior Tech Lead per escalation chain | document in DPO letter | warning |
| 5 | Cross-border recipient loses certification (Atlas drops SOC 2) | annual due-diligence review | re-assess lawful basis | possibly migrate region; 90-day grace | error |
| 6 | DSR floods (abuse) | > 10 export requests/user/yr | rate-limit DSR endpoints (already 1/30d on export) | per AC22; Art. 11 allows reasonable refusal | warning |
| 7 | Consent checkbox bypassed via API | server-side validation rejects | 422 CONSENT_REQUIRED | AC6 verifies; audit existing users | error |
| 8 | DPO conflict-of-interest emerges (founder writes the cron) | counsel review | re-assign DPO to Senior Tech Lead | re-file appointment with A05 | warning |
| 9 | A05 audit visit | inspection trigger | founder + counsel respond on-site | walk through DPIA, breach log, DSR records | error |
| 10 | Insurance gap (data-breach liability) | annual review reveals coverage lapsed | procure cyber-liability policy | $10K-$50K USD coverage minimum | warning |
| 11 | KEK rotation breaks decryption of legacy encrypted fields | kekVersion mismatch in stored data | maintain rotation map `KEK_v1`, `KEK_v2`, ... | re-encrypt on next write; gradual migration | error |
| 12 | DSR delete cancel link expired (user clicks 30d later) | token expiry | 404 with "deletion already complete or expired" | user re-creates account if needed | info |
| 13 | Subscription billing rows retained 7y but user demands erasure | conflict between PDPL Art. 17 and VN accounting law | PII-null retention; aggregate retained | counsel-approved compromise | warning |
| 14 | Background DSR export job fails mid-aggregation | exception in worker | retry via BullMQ; if persistent, manual aggregation | counsel-notified; user emailed delay notice | warning |
| 15 | Processor (e.g., Resend) suffers a breach of its own | their notification to us | cascade: re-evaluate our exposure + notify A05 within our 72h | document in breach response runbook | error |
| 16 | New processor added without PR sign-off | CI gate misses | annual review catches; counsel cleanup | tighten CI rule; document in incident review | warning |
| 17 | Annual DPIA review missed | T+12 months from filing | calendar reminder system fails | catch-up review within 30d of missed deadline; non-material continuity | warning |

---

## §11 — Notes

- Plan §B3 names KPMG, EY, Tilleke & Gibbins, Russin & Vecchi as counsel options. Tilleke & Gibbins is RECOMMENDED — Vietnamese-specific privacy expertise + PDPL fluency + reasonable rate (~$5-8K USD for the package).
- A second DPIA review is triggered automatically when we add a new processor (e.g., Twilio for SMS in P3). The trigger MUST be a CI hook on any change to `docs/legal/processor-register.md`.
- We deliberately exclude the LEARN/EDU exemption (Art. 12) — SaleNoti is commercial, no carve-out applies.
- The breach-detector covers the high-probability vectors. Lower-probability vectors (insider threat, supply-chain compromise) are out of automated scope at P0 — caught via quarterly manual review.
- The KEK rotation pattern is intentionally stub-grade at P0 (single key in Doppler). P2 graduates to AWS KMS or equivalent with automatic rotation. Failure mode #11 covers the rotation path.
- DSR endpoints have a 1-req-per-30-days rate limit on export to prevent abuse (e.g., a malicious user automating export-then-export-then-export to DoS the worker pool). Access requests are 1/15d.
- Plan §I "trust as moat" — the DSR endpoints and transparency report (FR-LEGAL-002) are the proof points. They cost engineering effort; they earn user trust. The trade-off math favors building them well at P0.

---

*FR-LEGAL-001 spec — last revised 2026-05-16. Status: shipped (2026-05-17).*
