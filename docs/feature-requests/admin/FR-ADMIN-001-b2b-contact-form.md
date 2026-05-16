---
id: FR-ADMIN-001
title: "Public B2B contact form — lead capture for Mall/Brand sellers wanting price-intel dashboard"
module: ADMIN
priority: SHOULD
phase: P2
status: SPEC_READY
template: engineering-spec@1
owner: growth-team
reviewers: [legal, eng-web, eng-api, sales]
last_revised: 2026-05-16
plan_anchors: [§F6 b2b-monetization, §F2 #8]
depends_on: [FR-LEGAL-002, FR-OBS-001]
blocked_by: []
unlocks: []
---

## §1 — Description (normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174).

1. The system MUST expose public endpoint `POST /api/public/b2b-contact` that accepts `{ companyName, contactName, email, phone, shopeeStoreUrl?, monthlyOrders?: "<100"|"100-1000"|"1000-10000"|">10000", useCase: string (max 500), source?: "homepage"|"footer"|"blog"|"other" }` and returns `{ leadId, message, expectedResponseHours }`.
2. The endpoint MUST be CSRF-protected via origin-allowlist (`https://sale.cyber.skill` only); cross-origin POST MUST return 403.
3. The endpoint MUST be rate-limited at `5 submissions/IP-day` and `20 submissions/email-day` (after the same email submits >3, subsequent submissions queued for manual review). Rate-limit response MUST be `429 RATE_LIMIT_LEADS`.
4. The endpoint MUST run hCaptcha v3 verification (token from frontend); failed captcha MUST return `403 CAPTCHA_FAILED`.
5. Lead data MUST be persisted in `b2b_leads` collection: `{ leadId, companyName, contactName, email (sha256 hashed for analytics + plaintext for outreach), phone, shopeeStoreUrl?, monthlyOrders?, useCase, source?, ip_hash, ua_hash, status: "new"|"contacted"|"qualified"|"won"|"lost", createdAt, contactedAt?, contactedBy?, notes? }`.
6. On successful submission, the system MUST: (a) send confirmation email to lead's email address via Resend with `from: sales@cyberskill.world`, `subject: "Cảm ơn bạn đã liên hệ CyberSkill"`, body templated with `contactName` + 24h response promise; (b) send internal Slack notification to `#b2b-leads` channel with lead details (excluding sensitive PII like full phone — last-4-digits only); (c) emit PostHog `b2b_lead_submitted` event with `{ source, monthlyOrders, hasShopeeStore: bool }` (no PII).
7. The form MUST be rendered on public pages: `/business` (primary landing), `/footer` (link only, opens modal), `/blog/<slug>` (sidebar widget on B2B-tagged posts). The form MUST be `form` element with all standard accessibility attributes (labels, aria-* per FR-LEGAL-002 a11y rule).
8. The form MUST display affiliate-disclosure-style transparency block: "CyberSkill cung cấp dashboard giá Shopee cho Mall/Brand sellers. Liên hệ này không cam kết về giá, hợp đồng, hay khả năng triển khai."
9. PII handling: `email` and `phone` MUST be encrypted at rest using `envelope_encrypt` per FR-LEGAL-001 §1 (AES-256-GCM under DPDK-managed KEK). Plaintext values MUST be retrievable only by admin role with `b2b:read_pii` permission and MUST log `audit:b2b_pii_read` event with `{ adminId, leadId, ts, reason }`.
10. Lead retention MUST be `36 months` from `createdAt` for "won" leads (active customer relationship), `12 months` for "lost"/"unqualified", `6 months` for "new" with no follow-up. After retention, PII MUST be purged via `delete(mode: "purge")` per AGENTS.md §3.6; aggregated stats (count, monthlyOrders bucket) MAY be retained indefinitely.
11. The endpoint MUST run server-side spam detection: (a) bot-detection via UA header (block `curl|python-requests|httpie` defaults — warn admin instead of silent reject), (b) email validation (RFC 5322 + MX record check via DNS lookup), (c) `useCase` profanity / spam-phrase filter (basic Vietnamese-English keyword list, ~50 entries).
12. The form MUST include explicit PDPL consent checkbox: "Tôi đồng ý cho CyberSkill liên hệ về dịch vụ B2B và lưu trữ thông tin theo Chính sách bảo mật". Unchecked submission MUST return 422 CONSENT_REQUIRED.
13. The admin dashboard MUST expose `/admin/b2b-leads` (admin role required) with: list view (filterable by status, source, date), detail view (full PII visible with audit log), status-update controls (new → contacted → qualified → won/lost), export to CSV (PII-redacted by default, admin can request full export with double-confirm).
14. The system MUST send daily digest email to `sales@cyberskill.world` at 09:00 ICT summarizing previous-day leads (count, sources, follow-up-overdue list). Digest MUST NOT include lead PII — only counts + leadId links.
15. The B2B page `/business` MUST disclose: pricing tiers (Starter $99/mo, Growth $299/mo, Enterprise custom), included features (dashboard access, API quota, alert customization), and a "Book a demo" CTA distinct from the contact form (Calendly-style integration optional, P3).

## §2 — Why this design

The B2B contact form is the only revenue capture surface for the Mall/Brand monetization stream (plan §F6). All consumer-side features are free or freemium ($1.50/mo Pro); B2B is where ARPU jumps 100-1000x. The form is therefore the highest-stake lead-capture in the product — every dropped or mishandled lead is potentially $300-3000 ARR lost.

The triple-rate-limit design (§1 #3: IP + email + manual-review queue) was added in round-2 after threat modeling: a competitor could spam the form to (a) waste sales-team time, (b) inflate analytics, (c) pollute the lead DB. IP-only limits fail because corporate NATs share IPs across legitimate users; email-only fails because attackers can rotate addresses. The combination + manual-review escape valve handles edge cases without false-blocking real customers.

The PII-encryption-at-rest rule (§1 #9) elevates B2B lead data above the standard PDPL baseline. Mall/Brand sellers' contact details are commercially valuable; a leak would damage both privacy and competitive position. The audit log on PII reads is the deterrent against insider-misuse.

The 24h response promise in the confirmation email (§1 #6) is a deliberate commitment forcing function. Without it, leads decay rapidly (industry data: B2B response rate halves every 60min after submission). The daily digest (§1 #14) + Slack ping (§1 #6b) ensures the sales team cannot accidentally let leads age past the promise.

The graduated retention rules (§1 #10: 36/12/6 months by status) balance PDPL minimization with operational needs. Won leads are active customers — 36 months covers a typical B2B SaaS lifecycle. Lost leads age out at 12 months because re-engagement is unlikely. New-no-follow-up at 6 months is the early-warning gate forcing sales-team triage.

The explicit consent checkbox (§1 #12) is non-negotiable under PDPL Article 11 (consent for personal data processing must be specific, informed, and freely given). Pre-checked boxes are explicitly prohibited. The uncheck-to-block UX is slightly higher friction but legally clean.

The disclosure block on the form (§1 #8) prevents future commercial disputes. Without it, a lead could claim our marketing implied a guaranteed quote, contract, or integration. The "no commitment on price/contract/feasibility" line makes the form a pure information-gathering surface.

## §3 — API contract & code shape

```ts
const B2BContactInput = z.object({
  companyName: z.string().min(2).max(120),
  contactName: z.string().min(2).max(80),
  email: z.string().email().max(120),
  phone: z.string().regex(/^\+?[\d\s()-]{8,20}$/),
  shopeeStoreUrl: z.string().url().regex(/shopee\.vn/).optional(),
  monthlyOrders: z.enum(["<100", "100-1000", "1000-10000", ">10000"]).optional(),
  useCase: z.string().min(20).max(500),
  source: z.enum(["homepage", "footer", "blog", "other"]).optional(),
  consentPdpl: z.literal(true), // must be checked
  captchaToken: z.string().min(20), // hCaptcha token
});

type B2BContactOutput = {
  leadId: string;
  message: string; // localized "Cảm ơn bạn đã liên hệ. Đội ngũ sẽ phản hồi trong 24h."
  expectedResponseHours: 24;
};

// Errors
type ApiError =
  | { code: "CONSENT_REQUIRED", http: 422 }
  | { code: "CAPTCHA_FAILED", http: 403 }
  | { code: "RATE_LIMIT_LEADS", http: 429, retryAfter: number }
  | { code: "INVALID_INPUT", http: 422, fields: Record<string, string> }
  | { code: "SPAM_DETECTED", http: 400, reason: string };
```

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | valid B2B form submission with consent + captcha | POST /api/public/b2b-contact | response 200, leadId nanoid(12), confirmation email sent to lead, Slack ping to #b2b-leads, lead persisted with encrypted email+phone |
| AC2 | submission with `consentPdpl: false` | POST | response 422 CONSENT_REQUIRED |
| AC3 | failed hCaptcha token | POST | response 403 CAPTCHA_FAILED |
| AC4 | 6th submission from same IP today | POST | response 429 RATE_LIMIT_LEADS |
| AC5 | 4th submission from same email today | POST | lead queued for manual review (`status: "review"`); admin Slack ping |
| AC6 | curl user-agent submission | POST | submission persisted but Slack alert flagged "suspicious_ua"; admin reviews |
| AC7 | submission with profanity in useCase | POST | response 400 SPAM_DETECTED with sanitized reason |
| AC8 | admin GET /admin/b2b-leads | authenticated admin with b2b:read_pii role | full PII visible, `audit:b2b_pii_read` event logged |
| AC9 | admin requests CSV export | export button | CSV downloaded with email/phone redacted to `***@domain.com` and `***-1234` |
| AC10 | admin requests full PII export with double-confirm | second confirm | CSV with full PII, `audit:b2b_full_export` event logged with reason |
| AC11 | lead older than 36 months in "won" status | retention cron | PII purged (email, phone fields → null); aggregate `status, monthlyOrders` retained |
| AC12 | daily digest 09:00 ICT | cron tick | email to sales@ with previous-day stats; no PII in body |
| AC13 | confirmation email | post-submission | from `sales@cyberskill.world`, body includes contactName + 24h promise |
| AC14 | submission from non-allowlist origin | POST with `Origin: https://attacker.com` | response 403 |
| AC15 | form rendered on /business | page load | all aria labels present, consent checkbox unchecked by default, disclosure text visible |

## §5 — Verification

```ts
describe("FR-ADMIN-001 b2b-contact-form", () => {
  it("AC1: accepts valid submission and triggers side effects", async () => {
    const r = await POST("/api/public/b2b-contact", validInput());
    expect(r.status).toBe(200);
    expect(r.leadId).toMatch(/^[\w-]{12}$/);
    expect(resendMock.sentTo).toContainEqual(expect.objectContaining({ to: validInput().email }));
    expect(slackMock.messages).toContainEqual(expect.objectContaining({ channel: "#b2b-leads" }));
    const lead = await db.b2b_leads.findOne({ leadId: r.leadId });
    expect(lead.email).not.toBe(validInput().email); // encrypted
    expect(decrypt(lead.email)).toBe(validInput().email);
  });
  it("AC2: rejects missing consent", async () => {
    const r = await POST("/api/public/b2b-contact", { ...validInput(), consentPdpl: false });
    expect(r.status).toBe(422);
    expect(r.error).toBe("CONSENT_REQUIRED");
  });
  it("AC4: rate-limits by IP", async () => {
    for (let i = 0; i < 5; i++) await POST("/api/public/b2b-contact", validInput({ email: `u${i}@a.com` }));
    const r = await POST("/api/public/b2b-contact", validInput({ email: "u6@a.com" }));
    expect(r.status).toBe(429);
  });
  it("AC5: 4th same-email submission queued for review", async () => {
    for (let i = 0; i < 4; i++) await POST("/api/public/b2b-contact", validInput({ email: "same@a.com" }));
    const lead = await db.b2b_leads.findOne({ email_hash: sha256("same@a.com") }, { sort: { createdAt: -1 } });
    expect(lead.status).toBe("review");
  });
  it("AC8: admin PII read logs audit event", async () => {
    const lead = await createLead();
    await GET(`/admin/b2b-leads/${lead.leadId}`, { adminId: "a1", role: "b2b:read_pii" });
    const audit = await db.audit_log.findOne({ event: "b2b_pii_read", leadId: lead.leadId });
    expect(audit).toBeTruthy();
    expect(audit.adminId).toBe("a1");
  });
  it("AC11: retention purges PII after 36 months for 'won'", async () => {
    const lead = await createLead({ status: "won", createdAt: monthsAgo(37) });
    await retentionCron.run();
    const after = await db.b2b_leads.findOne({ leadId: lead.leadId });
    expect(after.email).toBeNull();
    expect(after.phone).toBeNull();
    expect(after.status).toBe("won"); // status retained
  });
  it("AC14: CSRF origin enforcement", async () => {
    const r = await fetch("/api/public/b2b-contact", { method: "POST", headers: { Origin: "https://evil.com" } });
    expect(r.status).toBe(403);
  });
});
```

## §6 — Implementation skeleton

```ts
// apps/api/src/admin/b2b-leads.service.ts
@Injectable()
export class B2BLeadsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly hcaptcha: HCaptchaService,
    private readonly resend: ResendService,
    private readonly slack: SlackService,
    private readonly posthog: PostHogService,
    private readonly crypto: CryptoService,
  ) {}

  async submitLead(input: B2BContactInput, meta: { ip: string; ua: string; origin: string }): Promise<B2BContactOutput> {
    if (!isAllowedOrigin(meta.origin)) throw new ForbiddenException("CSRF_BLOCKED");
    if (!input.consentPdpl) throw new ValidationException("CONSENT_REQUIRED");

    const captchaOk = await this.hcaptcha.verify(input.captchaToken, meta.ip);
    if (!captchaOk) throw new ForbiddenException("CAPTCHA_FAILED");

    await this._enforceRateLimit(meta.ip, input.email);
    if (containsProfanity(input.useCase)) throw new BadRequestException("SPAM_DETECTED", "useCase profanity");
    if (!(await this._verifyEmailMx(input.email))) throw new BadRequestException("SPAM_DETECTED", "email MX not found");

    const suspicious = isSuspiciousUA(meta.ua);
    const leadId = nanoid(12);
    const lead = {
      leadId,
      companyName: input.companyName,
      contactName: input.contactName,
      email_encrypted: this.crypto.envelopeEncrypt(input.email),
      email_hash: sha256(input.email.toLowerCase()).slice(0, 24),
      phone_encrypted: this.crypto.envelopeEncrypt(input.phone),
      phone_last4: input.phone.slice(-4),
      shopeeStoreUrl: input.shopeeStoreUrl ?? null,
      monthlyOrders: input.monthlyOrders ?? null,
      useCase: input.useCase,
      source: input.source ?? "other",
      ip_hash: sha256(meta.ip + process.env.IP_SALT).slice(0, 16),
      ua_hash: sha256(meta.ua + process.env.UA_SALT).slice(0, 12),
      status: suspicious ? "review" : "new",
      createdAt: new Date(),
    };
    await this.db.b2b_leads.insertOne(lead);

    await Promise.allSettled([
      this.resend.send({
        to: input.email, from: "sales@cyberskill.world",
        subject: "Cảm ơn bạn đã liên hệ CyberSkill",
        template: "b2b-confirmation", vars: { contactName: input.contactName, leadId },
      }),
      this.slack.post("#b2b-leads", {
        text: `New B2B lead: ${input.companyName} (${input.contactName}) — ${input.monthlyOrders ?? "n/a"} orders/mo`,
        attachments: [{ leadId, source: input.source, suspicious }],
      }),
    ]);

    this.posthog.capture("b2b_lead_submitted", {
      source: input.source, monthlyOrders: input.monthlyOrders, hasShopeeStore: !!input.shopeeStoreUrl,
    });

    return { leadId, message: "Cảm ơn bạn đã liên hệ. Đội ngũ sẽ phản hồi trong 24h.", expectedResponseHours: 24 };
  }

  private async _enforceRateLimit(ip: string, email: string): Promise<void> {
    const ipKey = `b2b:ip:${sha256(ip).slice(0,16)}:${dayBucket()}`;
    const emailKey = `b2b:email:${sha256(email.toLowerCase()).slice(0,16)}:${dayBucket()}`;
    const ipCount = await this.redis.incr(ipKey);
    await this.redis.expire(ipKey, 86400);
    if (ipCount > 5) throw new RateLimitException("RATE_LIMIT_LEADS", { retryAfter: secondsUntilMidnight() });
    const emailCount = await this.redis.incr(emailKey);
    await this.redis.expire(emailKey, 86400);
    if (emailCount > 20) throw new RateLimitException("RATE_LIMIT_LEADS", { retryAfter: secondsUntilMidnight() });
    // 4th submission queued for review (not blocked, but flagged)
  }

  private async _verifyEmailMx(email: string): Promise<boolean> {
    const domain = email.split("@")[1];
    try {
      const records = await dns.resolveMx(domain);
      return records.length > 0;
    } catch { return false; }
  }

  async retentionPurge(): Promise<void> {
    const now = new Date();
    const cutoffWon = new Date(now.getTime() - 36 * 30 * 86400_000);
    const cutoffLost = new Date(now.getTime() - 12 * 30 * 86400_000);
    const cutoffNew = new Date(now.getTime() - 6 * 30 * 86400_000);
    await this.db.b2b_leads.updateMany(
      { $or: [
        { status: "won", createdAt: { $lt: cutoffWon } },
        { status: { $in: ["lost", "unqualified"] }, createdAt: { $lt: cutoffLost } },
        { status: "new", contactedAt: null, createdAt: { $lt: cutoffNew } },
      ] },
      { $set: { email_encrypted: null, phone_encrypted: null, ip_hash: null, ua_hash: null }, $unset: { phone_last4: 1 } },
    );
  }
}

function isAllowedOrigin(origin: string): boolean {
  const allowlist = ["https://sale.cyber.skill", "https://www.sale.cyber.skill"];
  return allowlist.includes(origin);
}

function isSuspiciousUA(ua: string): boolean {
  return /^(curl|python-requests|httpie|wget|java|axios)/i.test(ua);
}
```

## §7 — Dependencies

- FR-LEGAL-002 (disclosure components) — disclosure block on form
- FR-LEGAL-001 (envelope encryption) — PII at rest
- FR-OBS-001 — audit logging for `b2b_pii_read` and `b2b_full_export`
- hCaptcha v3 (third-party SaaS)
- Resend (email)
- Slack webhook (#b2b-leads channel)
- PostHog (analytics, no PII)

## §8 — Example payloads

Submission:
```json
{
  "companyName": "Công Ty TNHH Mỹ Phẩm ABC",
  "contactName": "Nguyễn Văn A",
  "email": "a.nguyen@my-pham-abc.vn",
  "phone": "+84 90 123 4567",
  "shopeeStoreUrl": "https://shopee.vn/my-pham-abc",
  "monthlyOrders": "1000-10000",
  "useCase": "Chúng tôi muốn theo dõi giá đối thủ và phát hiện flash sale để điều chỉnh giá kịp thời.",
  "source": "homepage",
  "consentPdpl": true,
  "captchaToken": "h_token_abc123..."
}
```

Response:
```json
{
  "leadId": "lead_8f2k9d3pqr1z",
  "message": "Cảm ơn bạn đã liên hệ. Đội ngũ sẽ phản hồi trong 24h.",
  "expectedResponseHours": 24
}
```

## §9 — Open questions (resolved)

**Q1: Why not use a CRM (HubSpot/Pipedrive) directly?**
A: P2 scope is internal DB + Slack. P3 can integrate a CRM via webhook for sales-team workflow. Direct CRM dependency at MVP adds vendor lock-in before product-market fit.

**Q2: Should we capture company size / industry as required fields?**
A: No — `monthlyOrders` is the highest-signal proxy and is optional. Required fields drop completion rates by ~30% per industry benchmarks; we prefer breadth (more leads, lighter signal) at P2.

**Q3: Confirmation email in English or Vietnamese?**
A: Vietnamese-default per target market. English fallback if `Accept-Language` header starts with `en-`. P3 i18n if international sellers emerge.

**Q4: Why hCaptcha not reCAPTCHA?**
A: hCaptcha privacy posture is stronger (less Google-tracking-baggage) and PDPL-friendly. Trade-off: slightly lower bot-catch rate, but combined with rate-limit + spam-filter, sufficient for P2.

**Q5: Allow file upload (e.g. business registration)?**
A: Out of scope P2. Adds attack surface (PDF parsing, virus scanning, storage). P3 if sales team requests.

**Q6: Phone number SMS validation?**
A: Deferred — Vietnamese SMS verification adds cost ($0.03/SMS) without proportional value at MVP. Manual sales-team callback validates.

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Resend email service down | confirmation email fails | exception in Promise.allSettled | lead persisted, retry queue picks up; sales-team notified via Slack regardless | warning |
| 2 | Slack webhook down | #b2b-leads ping fails | webhook 5xx | sales-team relies on daily digest fallback (§1 #14); lead in DB | warning |
| 3 | hCaptcha service down | captcha verify fails | provider 5xx | graceful degrade to client-side honeypot field; alert admin; consider temporary captcha bypass for known-good IPs (manual override) | error |
| 4 | MX-record DNS slow | spam check times out | exceeds 5s budget | accept email without MX check; flag as `mx_unverified` for admin review | warning |
| 5 | concurrent form submits race-write | two submits within ms | Mongo upsert idempotent on leadId | distinct leadIds, both persist; admin dedupes via email_hash query | info |
| 6 | encryption KEK rotation | KEK changed | old leads still decryptable via KEK version | KEK-version-tagged ciphertexts per FR-LEGAL-001 envelope | info |
| 7 | retention purge fails mid-batch | DB error mid-update | partial update | resumable via marker on lead row; safe to re-run | info |
| 8 | profanity filter false positive | legitimate use case contains flagged word | 400 SPAM_DETECTED | sales-team Slack-ping on rejection with full payload; admin can whitelist + re-process | warning |
| 9 | suspicious UA blocked legitimate API integration | enterprise customer uses Java HTTP client | rejected with SPAM warning | admin reviews queue; whitelists IP after verification | info |
| 10 | admin export with full PII | compliance/legal audit request | double-confirm gate | export logged with reason; auto-redaction after 7 days | info |
| 11 | lead resubmits with new email | same person, different address | email_hash differs | duplicate detection by phone_hash + companyName fuzzy match; sales-team manual merge | info |
| 12 | XSS in companyName/useCase | attacker submits `<script>` | server-side escape on render | admin dashboard uses React auto-escape; CSV export escapes per RFC 4180 | error if escapes broken |
| 13 | PDPL consent dropped silently | client-side bug strips `consentPdpl: true` | server requires literal true | 422 CONSENT_REQUIRED returned to client; client surfaces error | info |
| 14 | timezone-confused daily digest | digest fires UTC midnight instead of ICT 09:00 | scheduler cron schedule | `TZ=Asia/Ho_Chi_Minh` explicit on cron; AC12 verifies 09:00 ICT | info |

## §11 — Notes

- B2B pricing tiers ($99/$299/custom) are placeholder pending sales-team finalization; P2 ships the form with the page rendering "Liên hệ để biết thêm chi tiết" until pricing is locked.
- Calendly integration for "Book a demo" deferred to P3.
- CRM webhook integration deferred to P3.
- Anti-spam profanity list maintained in `apps/api/config/spam-keywords.json` — version-controlled, sales-team reviews monthly.
- Lead aging report (leads in `new` > 24h without contact) is in daily digest — sales SLA tracking.

---

*FR-ADMIN-001 spec — last revised 2026-05-16.*
