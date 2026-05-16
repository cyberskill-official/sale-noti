---
id: FR-AUTH-002
title: "Email magic-link sign-in (Resend transactional + 15-min single-use token)"
module: AUTH
priority: MUST
status: accepted
verify: T
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Stephen Cheng (Founder + Senior Tech Lead)
created: 2026-05-16
related_frs: [FR-AUTH-001, FR-AUTH-003, FR-NOTIF-001]
depends_on: [FR-AUTH-001]
blocks: [FR-AUTH-003, FR-WATCH-001, FR-EXT-001]
effort_hours: 5

new_files:
  - apps/web/src/server/auth/magic-link/issue.ts
  - apps/web/src/server/auth/magic-link/consume.ts
  - apps/web/src/app/api/auth/magic-link/issue/route.ts
  - apps/web/src/app/api/auth/magic-link/consume/route.ts
  - apps/web/src/server/email/templates/magic-link.tsx
  - apps/web/tests/integration/auth.magic-link.spec.ts
modified_files:
  - apps/web/src/auth.ts
allowed_tools:
  - "file_read/write apps/web/**"
  - "bash pnpm test"
disallowed_tools:
  - "log raw magic-link token to any destination (Sentry, PostHog, console)"
  - "allow the same token to be consumed more than once"
  - "issue magic-link without disclosing affiliate program (FR-LEGAL-002 §2)"
risk_if_skipped: "Without magic-link, every user MUST have a Google account. Plan §F1 personas (Mẹ bỉm sữa 25-35, Sinh viên) include a non-trivial subset without Google preference; offering Email+Pass is heavier (password reset flow, leak risk). Magic-link is the canonical lightweight fallback."

---

## §1 — Description (BCP-14 normative)

The web app MUST expose magic-link email authentication as a secondary path alongside Google OAuth (FR-AUTH-001).

1. **MUST** expose `POST /api/auth/magic-link/issue` body `{ email: string }`. Validates email shape; issues a token if and only if email is well-formed.
2. **MUST** issue a cryptographically random 256-bit token (`crypto.randomBytes(32).toString("base64url")`), store `{ tokenHash: sha256(token), email, expiresAt: now + 15min, consumed: false }` in MongoDB `magic_link_tokens` collection (TTL index on `expiresAt`).
3. **MUST** send the magic-link email via Resend with the React Email template at `apps/web/src/server/email/templates/magic-link.tsx`. The CTA URL is `${APP_URL}/api/auth/magic-link/consume?token=<token>`.
4. **MUST** expire tokens after 15 minutes (TTL index + explicit check in consume).
5. **MUST** make tokens **single-use**: on `GET /api/auth/magic-link/consume?token=...`, atomically `findOneAndUpdate({ tokenHash, consumed: false, expiresAt: { $gt: now } }, { $set: { consumed: true, consumedAt: now } })`. If no row matched → 401 with `error=invalid_or_expired_token`.
6. **MUST** rate-limit `POST /api/auth/magic-link/issue` to 3 req/min/email + 10 req/min/IP. Return 429 with `Retry-After` on breach.
7. **MUST** rate-limit `GET /api/auth/magic-link/consume` to 20 req/min/IP (consume side, lighter limit because tokens are unguessable).
8. **MUST** on successful consume, run the same `upsertUserOnSignIn` flow as Google sign-in (provider field becomes `"magic-link"` instead of `"google"`), then set the Auth.js session cookie and 302 to `/dashboard`.
9. **MUST NOT** log the raw token to Sentry, PostHog, console, or any audit row. Only `tokenHash` may appear in logs.
10. **MUST** disclose in the magic-link email body, exactly as approved in FR-LEGAL-002 §2: "SaleNoti là price-tracker affiliate dùng Shopee Affiliate Open API. Khi bạn click vào deal trong alert, chúng tôi nhận hoa hồng. Bạn không trả thêm." (or English equivalent based on `accept-language`).
11. **MUST** complete issue-side round-trip (POST→Resend handoff→200) in < 300 ms p95 (Resend SDK call returns when accepted to outbound queue; actual delivery is async).
12. **MUST** emit Sentry breadcrumbs `auth.magic_link.{issued,consumed,rejected}` and PostHog events `auth_sign_in_method: "magic-link"` on consume success.

---

## §2 — Why this design

**Why 15 minutes:** OWASP Authentication Cheat Sheet recommends 5–30 minutes for magic-link expiry. 15 is the median; long enough for users who switch tabs to check email, short enough to bound replay risk.

**Why single-use atomic `findOneAndUpdate`:** prevents the classic race where two browser tabs consume the same link. Mongo's atomic update ensures exactly one tab succeeds.

**Why `tokenHash` not `token` stored:** if MongoDB is compromised, an attacker cannot enumerate live tokens. Same defense-in-depth pattern as password hashes.

**Why Resend (not SendGrid, not SES, not raw SMTP):** plan §C6 explicitly recommends Resend. Free 3K/mo + $20/50K is the cheapest at MVP scale. React Email templates compile to MIME at edge — no template-server. Resend supports inbound webhooks for bounce/complaint handling (we wire those in FR-NOTIF-001).

**Why 3/min/email AND 10/min/IP:** the per-email cap defeats single-user abuse (someone spamming magic-links to a victim). The per-IP cap defeats credential-spraying across many emails.

**Why a disclosure paragraph in the email body:** FTC affiliate disclosure rules + Chrome Web Store 3/2025 Affiliate Ads Policy + plan §A3 principle 2 (transparency). The first email a user receives from us must disclose. Saves us from the "user didn't know" defence later (cf. Honey/PayPal scandal lessons in plan §A2).

---

## §3 — API contract

### Issue

```http
POST /api/auth/magic-link/issue
Content-Type: application/json

{ "email": "user@example.com" }
```

Response (always 200 — do not leak email existence):

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ "ok": true, "message": "If that email is registered or eligible, a sign-in link is on its way." }
```

### Consume

```http
GET /api/auth/magic-link/consume?token=<base64url-32-bytes>
```

Success (302):

```http
HTTP/1.1 302 Found
Location: /dashboard
Set-Cookie: authjs.session-token=...; HttpOnly; Secure; SameSite=Lax; Max-Age=900
```

Failure (302):

```http
HTTP/1.1 302 Found
Location: /auth/error?code=invalid_or_expired_token
```

### MongoDB collection

```ts
// magic_link_tokens
{
  _id: ObjectId,
  tokenHash: string,     // sha256(rawToken) hex
  email: string,
  expiresAt: Date,       // TTL index — automatic purge
  consumed: boolean,
  consumedAt: Date | null,
  createdAt: Date,
  ip: string,            // for abuse forensics
  userAgent: string,
}
// Indexes: { tokenHash: 1 } unique, { email: 1, createdAt: -1 }, { expiresAt: 1 } TTL
```

---

## §4 — Acceptance criteria

1. POST issue with valid email → 200 + Resend logs an outbound message; `magic_link_tokens` row inserted; raw token does not appear in any log destination.
2. POST issue with invalid email (`"not-an-email"`) → 400 with `error: "invalid_email"`.
3. GET consume with valid unexpired unconsumed token → 302 to `/dashboard` + session cookie set + `users` row upserted.
4. GET consume with same token a second time → 302 to `/auth/error?code=invalid_or_expired_token`.
5. GET consume with expired token (forge `expiresAt` in past) → 302 to error.
6. GET consume with random/non-existent token → 302 to error; no timing-side-channel between "expired" and "non-existent" (both go through same path).
7. 4 issue requests/min for same email → 4th returns 429 with `Retry-After`.
8. 11 issue requests/min from same IP (different emails) → 11th returns 429.
9. 21 consume requests/min same IP → 21st returns 429.
10. Email body contains the disclosure paragraph from §1 #10.
11. `pnpm test integration/auth.magic-link` is green.
12. Doctor: search the running process / Sentry / PostHog / DB logs for a known issued token — must return zero hits (only `tokenHash` should exist).

---

## §5 — Verification

```ts
// apps/web/tests/integration/auth.magic-link.spec.ts
import { describe, it, expect, vi } from "vitest";
import { request } from "../helpers/http";
import { mockResend, lastResendCall } from "../helpers/resend-mock";
import { mongo } from "@/server/db/mongo";
import crypto from "node:crypto";

describe("FR-AUTH-002 — magic-link auth", () => {
  it("AC1: issue → Resend called, raw token absent from logs", async () => {
    mockResend();
    const res = await request("/api/auth/magic-link/issue").post({ email: "u@example.com" });
    expect(res.status).toBe(200);
    const call = lastResendCall();
    const linkMatch = /token=([A-Za-z0-9_-]+)/.exec(call.html);
    expect(linkMatch).not.toBeNull();
    const rawToken = linkMatch![1];
    // Verify the raw token does NOT appear in stored doc
    const stored = await mongo.db("salenoti").collection("magic_link_tokens").findOne({ email: "u@example.com" });
    expect(stored?.tokenHash).toBe(crypto.createHash("sha256").update(rawToken).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(rawToken);
  });

  it("AC4: same token consumed twice — second 401", async () => {
    const { rawToken } = await issueAndCaptureToken("u@example.com");
    const first = await request(`/api/auth/magic-link/consume?token=${rawToken}`).get();
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe("/dashboard");
    const second = await request(`/api/auth/magic-link/consume?token=${rawToken}`).get();
    expect(second.headers.location).toMatch(/code=invalid_or_expired_token/);
  });

  it("AC6: random token — error redirect; no timing leak", async () => {
    const start = performance.now();
    const r1 = await request(`/api/auth/magic-link/consume?token=${crypto.randomBytes(32).toString("base64url")}`).get();
    const t1 = performance.now() - start;
    // … expired-token timing test parallel; assert |t1 - t_expired| < 20ms
    expect(r1.headers.location).toMatch(/code=invalid_or_expired_token/);
  });

  it("AC7: 4 issues/email/min → 429", async () => {
    for (let i = 0; i < 3; i++) await request("/api/auth/magic-link/issue").post({ email: "z@y.com" });
    const r4 = await request("/api/auth/magic-link/issue").post({ email: "z@y.com" });
    expect(r4.status).toBe(429);
    expect(r4.headers["retry-after"]).toBeDefined();
  });
});
```

---

## §6 — Implementation skeleton

```ts
// apps/web/src/server/auth/magic-link/issue.ts
import crypto from "node:crypto";
import { z } from "zod";
import { mongo } from "@/server/db/mongo";
import { resend } from "@/server/email/resend";
import MagicLinkEmail from "@/server/email/templates/magic-link";
import { sentry } from "@/server/obs/sentry";

const EmailSchema = z.string().email();

export async function issueMagicLink(input: { email: string; ip: string; userAgent: string }) {
  const email = EmailSchema.parse(input.email).toLowerCase();
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await mongo.db("salenoti").collection("magic_link_tokens").insertOne({
    tokenHash, email, expiresAt, consumed: false, consumedAt: null,
    createdAt: new Date(), ip: input.ip, userAgent: input.userAgent,
  });
  const url = `${process.env.APP_URL}/api/auth/magic-link/consume?token=${raw}`;
  await resend.emails.send({
    from: "SaleNoti <noreply@salenoti.vn>",
    to: email,
    subject: "Đăng nhập SaleNoti",
    react: MagicLinkEmail({ url, email }),
  });
  sentry.addBreadcrumb({ category: "auth.magic_link", message: "issued", data: { emailDomain: email.split("@")[1] } });
}
```

```ts
// apps/web/src/server/auth/magic-link/consume.ts
import crypto from "node:crypto";
import { mongo } from "@/server/db/mongo";
import { upsertUserOnSignIn } from "@/server/users/upsert-on-signin";
import { createSession } from "@/auth";    // helper around Auth.js JWT signing

export async function consumeMagicLink(rawToken: string) {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();
  const row = await mongo.db("salenoti").collection("magic_link_tokens").findOneAndUpdate(
    { tokenHash, consumed: false, expiresAt: { $gt: now } },
    { $set: { consumed: true, consumedAt: now } },
    { returnDocument: "before" }
  );
  if (!row) return { ok: false as const, code: "invalid_or_expired_token" };
  const upsert = await upsertUserOnSignIn({
    sub: `magic-link:${row.email}`,
    email: row.email,
    email_verified: true,
  } as any);
  if (!upsert.ok) return { ok: false as const, code: "USER_UPSERT_FAILED" };
  const cookie = await createSession({ userId: upsert.userId, method: "magic-link" });
  return { ok: true as const, cookie };
}
```

---

## §7 — Dependencies

- **External:** Resend account with `noreply@salenoti.vn` domain verified (SPF, DKIM, DMARC=quarantine min).
- **Internal:** FR-AUTH-001 ships first (the `upsertUserOnSignIn` helper).
- **Vendor:** `resend@^4.x`, `react-email/components@^0.x`, `zod@^3.x`.

---

## §8 — Example payloads

### Email body (React Email rendered)

```
From: SaleNoti <noreply@salenoti.vn>
To: u@example.com
Subject: Đăng nhập SaleNoti

Nhấn vào nút bên dưới để đăng nhập (link hết hạn sau 15 phút):

[ Đăng nhập SaleNoti ] → https://salenoti.vn/api/auth/magic-link/consume?token=…

Nếu bạn không yêu cầu link này, có thể bỏ qua email — link sẽ tự hết hạn.

---
SaleNoti là price-tracker affiliate dùng Shopee Affiliate Open API.
Khi bạn click vào deal trong alert, chúng tôi nhận hoa hồng. Bạn không trả thêm.
DPO: legal@salenoti.vn · CyberSkill JSC · 1st Floor 207A Nguyen Van Thu, Tan Dinh, HCMC.
```

---

## §9 — Open questions

All resolved:

- **Q1: 15 min or 5 min expiry?** Resolved → 15. 5 min causes "link expired" support churn for users on slow email.
- **Q2: Reveal email-not-found in 200 response?** Resolved → no. Always 200 with same message regardless of whether email is in `users`. Defeats user enumeration.
- **Q3: Store raw token or hash?** Resolved → hash only (§1 #2, §1 #9).
- **Q4: Single device or any?** Resolved → any device. Token doesn't bind to issuing IP/UA; we record them for forensics but don't enforce. Better UX (user issues on phone, opens on laptop).

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Email not deliverable (bounce) | Resend webhook | Token still consumable if user retrieves email later; bounce surfaces in OBS | Add to suppression list after 2 hard bounces |
| Resend API down | SDK error | 502 to caller; no token row written | Caller retries; Sentry alert |
| MongoDB write fails on insert | exception | 500 to caller | Sentry alert |
| Token expires in transit (slow mail) | row.expiresAt < now in consume | 302 to error | User re-issues |
| Race — two tabs consume | atomic findOneAndUpdate | exactly one wins; other gets `invalid_or_expired_token` | Loser re-issues |
| Email forwarded/leaked | tokenHash in DB | Single-use semantics make it consumable exactly once by whoever clicks first | None — design accepts this risk for 15 min window |
| TTL index lag | Mongo bg purge runs every 60s | Stale rows linger ≤ 60s; consume guard still enforces `expiresAt > now` | No user impact |
| Disclosure paragraph drift | template-snapshot test fails CI | PR blocked | Update test or restore paragraph |
| User enumerates emails via 429 timing | Per-email + per-IP combined rate | Both limits independent; timing-stable | Add jitter on 429 response |
| Phishing replica using our brand | n/a — out of scope for this FR | Brand monitor surface (P3 work) | DMARC + brand alerts |

---

## §11 — Notes

- The disclosure paragraph wording in §1 #10 is fixed by FR-LEGAL-002; do not edit independently.
- Once Telegram bot (FR-NOTIF-003, P2) ships, we may add a "magic-link-via-Telegram" path. Out of scope here.
- For B2B sellers (FR-ADMIN-001 P2) we'll layer email-domain allow-listing — out of scope for P0.

---

*End of FR-AUTH-002. Status: accepted (10/10).*
