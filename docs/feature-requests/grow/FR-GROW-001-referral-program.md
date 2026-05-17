---
id: FR-GROW-001
title: "Referral program — invite 3 qualified friends → unlock Pro 1 month; fraud-resistant; viral coefficient k≥0.4 target"
module: GROW
priority: MUST
status: shipped
shipped: 2026-05-17
verify: T
phase: P2
milestone: P2 · slice 1 · Growth & Monetization
slice: 1
owner: Growth/Marketing lead + Senior Tech Lead
created: 2026-05-16
related_frs: [FR-AUTH-001, FR-AUTH-003, FR-BILL-001, FR-WATCH-001, FR-LEGAL-001]
depends_on: [FR-AUTH-003, FR-BILL-001]
blocks: []
effort_hours: 6

new_files:
  - apps/api/src/growth/referral.service.ts
  - apps/api/src/growth/referral.controller.ts
  - apps/api/src/growth/fraud-detect.ts
  - apps/api/src/growth/__tests__/fraud-detect.spec.ts
  - apps/web/src/app/r/[refCode]/route.ts
modified_files:
  - apps/api/src/auth/sign-in.service.ts
allowed_tools:
  - "file_read/write apps/api/**"
  - "file_read/write apps/web/**"
  - "bash pnpm test"
disallowed_tools:
  - "credit referrals for the same email twice (fraud)"
  - "credit referrals from same /24 IP / same gmail-dot-stripped email family without manual review (gaming)"
  - "self-referral acceptance"
  - "auto-grant Pro bonus when fraud signals present — must hold for manual review"
risk_if_skipped: "Plan §F2 #6 'Referral program: refer 3 bạn → unlock Pro 1 tháng. Viral coefficient mục tiêu k=0.4.' This is the single highest-leverage growth lever in P2; combined with Mega Sale Mode (FR-GROW-003) and share-deal (FR-GROW-002), referral drives ~40% of organic acquisition per plan §F4. Without it, plan §I Phase 2 MRR target of 30M ₫ is unreachable on paid-only acquisition."

---

## §1 — Description (BCP-14 normative)

The growth service MUST implement a referral program with deterministic refCode generation, qualification gates against gaming, and automated reward issuance via subscription bonus months.

1. **MUST** generate a deterministic refCode per user: `refCode = base62(sha256(userId + REFERRAL_SALT)).slice(0, 8)`. Salt loaded from Doppler env `REFERRAL_SALT` (≥ 32 hex chars). Code is stable per user, idempotently re-derivable, indexed on `users.refCode`.
2. **MUST** expose `GET /v1/me/referral` returning `{ refCode, refLink: "https://salenoti.vn/r/<refCode>", invited: <count>, qualified: <count>, rewardsEarnedMonths: <count> }`. Counts driven by Mongo aggregation against `referrals` + `referral_rewards` collections.
3. **MUST** route `GET /r/<refCode>` (handled by `apps/web/src/app/r/[refCode]/route.ts`) to set `salenoti.ref=<refCode>; Max-Age=30d; Path=/; HttpOnly; Secure; SameSite=Lax` cookie and 302 redirect to home `/`. Cookie persists 30 d so the user can sign up later in the same browser.
4. **MUST** read `salenoti.ref` cookie on sign-up flow; if present and not the user's own refCode (self-referral check), call `ReferralService.onSignup({ newUserId, newUserEmail, newUserIp, refCode })` which:
   - Looks up the referrer by refCode (deterministic reverse via `findOne({ refCode })`),
   - Computes fraud signals against the (referrer, referred) pair via `detectFraud()`,
   - Persists `referrals` row with `status: "pending"`, `fraudSignals: <signals>`, `createdAt: now`.
5. **MUST** count an invite as **qualified** only when ALL conditions met:
   - **(a)** the invited user has verified their email (Google OAuth = automatic; magic-link = first consume),
   - **(b)** the invited user has created ≥ 3 distinct active watchlists within 7 days of sign-up.

   `checkQualification(userId)` is the canonical state-transition; called from FR-WATCH-001 success handler (after each track increment) and from FR-AUTH-002 magic-link verify handler.

6. **MUST** unlock 1 month of Pro automatically when the referrer reaches 3 qualified invites in a rolling 90-day window. Apply by:
   - Inserting `referral_rewards` row `{ referrerId, monthsGranted: 1, grantedAt: now, reason: "3_qualified_invites" }`,
   - Incrementing `subscriptions.bonusMonthsRemaining` by 1 (consumed by FR-BILL-001 at next renewal).

   Multiple rewards on the same referrer: every (qualifiedCount % 3 == 0 AND qualifiedCount > 0 AND rewardCount < qualifiedCount/3) issuance occurs idempotently.

7. **MUST** prevent self-referral (refCode == own user's refCode), same-`/24` IPv4 / same-`/64` IPv6 referral, and email-domain abuse (gmail-dot-stripped + plus-aliased email families). The `detectFraud()` pure function (see §3) returns `{ selfRefer, sameIp, samePlusAlias, anyFlag }`.
8. **MUST** emit PostHog events: `referral_link_clicked` (route `/r/<refCode>` hit), `referral_signup` (sign-up with refCode cookie), `referral_qualified` (qualification met), `referral_reward_unlocked` (3 qualified → bonus issued). All events carry `referrerIdHash` (sha256+salt+12-char prefix per FR-OBS-001 §1 #5) and never raw user IDs.
9. **MUST** rate-limit `/r/<refCode>` landing to 60 req/min/IP via Redis token bucket. Excess returns 429 (acceptable: legitimate users rarely re-visit the referral landing).
10. **MUST** record fraud signals in `referral_fraud_log` for manual review (admin tool in P3). On any flag (`fraudSignals.anyFlag === true`) the qualification automatically pauses — referrals with fraud flags stay `pending` indefinitely until manual review marks them `qualified` or `rejected`.
11. **MUST** validate refCode format on input: regex `^[A-Za-z0-9]{8}$`. Malformed refCode → silently drop cookie attempt, 302 to home anyway (don't leak refCode existence via differential response).
12. **MUST** lazy-backfill `users.refCode` field for any user lacking it: on first `findByRefCode()` cache miss, scan users without `refCode`, compute, persist. Forward-compat for users who signed up before this FR landed.
13. **MUST NOT** allow `bonusMonthsRemaining` to exceed `12` per user (sanity cap to prevent runaway abuse from undetected fraud rings).

---

## §2 — Why this design

**Why 3 qualified invites for 1 month Pro:** plan §F2 #6 explicit ("3 bạn → 1 tháng"). The math: typical qualification rate is ~33% (1 in 3 invited friends verifies email + tracks 3 products). So to earn 1 month a user must invite ~9 people. Strong viral pressure; doesn't trivialize the reward; calibrated to plan §I Phase 2 k=0.4 viral coefficient target.

**Why qualification gates (email-verified + 3 products tracked):** prevents bot armies. A user genuinely tracking 3 products in their first 7 days is showing real intent (plan §F1 personas — average new user tracks 5-8 products in first month). Bots filling in burner emails fail the 3-product gate; they could in theory script Shopee URL pasting but that's a non-trivial bot — qualification gate raises the bar for fraud-cost above 1-month-Pro value.

**Why 90-day rolling window for reward issuance:** caps abuse (drip-invite forever); matches Pro's natural product lifecycle (Pro at ~5K MAU → bonus matters; reward windows aligned with billing cycles).

**Why IP/email-family fraud checks (not just self-referral):** plan §F2 #6 doesn't specify but common sense. Without these, "refer myself with 3 burner emails" becomes the free-Pro exploit. The plus-alias check (`john+x@gmail.com` → `john@gmail.com`) is specifically Vietnamese-Gmail-pattern (most VN users use gmail; Yahoo, Outlook are minority).

**Why automate reward (no claim button):** removes friction; auto-applied is delightful UX. The alternative (claim button) introduces a delay between qualification and reward that breaks the magic. Auto + email confirmation is the right pattern.

**Why fraud flags pause but don't reject:** false-positive fraud signals (e.g., user + friend on same office Wi-Fi `/24` IP) are common and shouldn't auto-reject — that would create support tickets for legitimate referrals. Manual review in the admin tool (P3) is the cheap escape hatch; pending status until then.

**Why deterministic refCode (sha256 of userId + salt, not random):** deterministic codes are idempotent — if a user clears local state we re-derive the same code. Random codes would require DB-backed storage with risk of collision. 8 chars of base62 = ~218T collision space, sufficient for 1M users with negligible collision probability. The salt makes the code-to-userId mapping irreversible without backend access.

**Why 30-day refCode cookie:** users typically share the link on a Tuesday but their friend signs up Friday evening. 7 days is too short for the typical share-cycle; 60 days too long for cookie staleness on the same browser/device. 30 days is the standard "first-click-attribution" window in affiliate marketing.

**Why 60 req/min/IP rate limit on the landing:** legitimate users hit `/r/<refCode>` once per session at most. 60/min covers heavy testing or share-bomb scenarios; abuse traffic gets blocked above that.

**Why `bonusMonthsRemaining` cap at 12:** even if every fraud check fails, no single user accumulates more than 12 months of free Pro (~$170 max liability). At MVP scale this is a one-line safety net; at P3 we can revisit when fraud detection is more sophisticated.

---

## §3 — Code shape

### Deterministic refCode

```ts
// apps/api/src/growth/referral.service.ts
export class ReferralService {
  static refCodeFor(userId: string): string {
    const salt = process.env.REFERRAL_SALT ?? "";
    const h = crypto.createHash("sha256").update(`${userId}|${salt}`).digest();
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let out = "";
    for (let i = 0; i < 8; i++) out += alphabet[h[i]! % alphabet.length];
    return out;
  }
}
```

### Fraud detection (pure function)

```ts
// apps/api/src/growth/fraud-detect.ts
export function detectFraud(args: {
  referrerId: string;
  referredId: string;
  referrerIp?: string;
  referredIp?: string;
  referrerEmail?: string;
  referredEmail?: string;
}): FraudSignals {
  const selfRefer = args.referrerId === args.referredId;
  const sameIp = Boolean(args.referrerIp && args.referredIp && ipPrefix(args.referrerIp) === ipPrefix(args.referredIp));
  const samePlusAlias = Boolean(args.referrerEmail && args.referredEmail && emailRoot(args.referrerEmail) === emailRoot(args.referredEmail));
  return {
    selfRefer, sameIp, samePlusAlias,
    anyFlag: selfRefer || sameIp || samePlusAlias,
  };
}

function emailRoot(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return email.toLowerCase();
  const root = local.split("+")[0]!.replace(/\./g, "");  // gmail-dot-strip
  return `${root}@${domain}`;
}

function ipPrefix(ip: string): string {
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":");  // IPv6 /64
  const p = ip.split(".");
  return p.length === 4 ? p.slice(0, 3).join(".") : ip;              // IPv4 /24
}
```

### MongoDB collections

```ts
// referrals
{ _id, referrerId: ObjectId, referredId: ObjectId, refCode: string, status: "pending" | "qualified" | "rejected", createdAt: Date, qualifiedAt: Date | null, fraudSignals: { selfRefer, sameIp, samePlusAlias, anyFlag } }
// Indexes
//   { referrerId: 1, status: 1, qualifiedAt: -1 }
//   { referredId: 1 } unique
//   { refCode: 1 }

// referral_rewards
{ _id, referrerId: ObjectId, monthsGranted: number, grantedAt: Date, reason: "3_qualified_invites" }
// Indexes
//   { referrerId: 1, grantedAt: -1 }

// referral_fraud_log
{ _id, referralId: ObjectId, signals: FraudSignals, reviewed: boolean, reviewedAt: Date | null, reviewedBy: string | null, decision: "qualified" | "rejected" | null, loggedAt: Date }
```

### Endpoints

```http
GET /v1/me/referral
→ 200 OK
{ "refCode": "ab2x9q4Z", "refLink": "https://salenoti.vn/r/ab2x9q4Z", "invited": 7, "qualified": 4, "rewardsEarnedMonths": 1 }

GET /r/ab2x9q4Z
→ 302 Found
Location: /
Set-Cookie: salenoti.ref=ab2x9q4Z; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax
```

---

## §4 — Acceptance criteria

1. `GET /v1/me/referral` returns refCode (8 chars), refLink, and accurate counts.
2. `GET /r/<refCode>` sets cookie + 302 to `/`.
3. New user signs up with cookie set → referral row created with `status: "pending"`.
4. Self-referral (cookie == own refCode) → row not created OR explicit rejection; PostHog event with `kind: "self_referral"`.
5. New user verifies email + tracks 3 products → `checkQualification` flips row to `qualified`; referrer counter increments.
6. Referrer reaches 3 qualified in 90 d → bonus Pro month applied (subscriptions.bonusMonthsRemaining += 1); `referral_rewards` row inserted.
7. Same-`/24` IP referral → fraudSignal flagged AND status stays `pending` pending manual review even if user qualifies otherwise.
8. Plus-aliased email family (`john+a@gmail.com` referrer + `john+b@gmail.com` referred) → fraudSignal flagged.
9. Gmail-dot variants (`john.doe@gmail.com` vs `johndoe@gmail.com`) → counted as same family by emailRoot.
10. 61 landing hits/min/IP → 61st returns 429.
11. PostHog events `referral_signup`, `referral_qualified`, `referral_reward_unlocked` captured with `referrerIdHash`.
12. Reward unlock fires automatically without claim button.
13. Malformed refCode in `/r/<bad>` → silent drop cookie + 302 to home.
14. Same user referred twice (race) → unique-index on `referrals.referredId` catches; second attempt silent-ignored.
15. Cap: user with 36 qualified invites → maxes at 12 monthsGranted (not 12 = capped per §1 #13).
16. Lazy backfill: pre-existing user with no `refCode` field → first `findByRefCode` lookup forces backfill + returns correctly.

---

## §5 — Verification

```ts
// apps/api/src/growth/__tests__/fraud-detect.spec.ts
describe("FR-GROW-001 — detectFraud", () => {
  it("AC4: self-referral flagged", () => {
    expect(detectFraud({ referrerId: "u1", referredId: "u1" }).selfRefer).toBe(true);
  });
  it("AC7: same /24 IPv4 flagged", () => {
    expect(detectFraud({ referrerId: "u1", referredId: "u2", referrerIp: "27.71.10.5", referredIp: "27.71.10.99" }).sameIp).toBe(true);
  });
  it("different /24 not flagged", () => {
    expect(detectFraud({ referrerId: "u1", referredId: "u2", referrerIp: "27.71.10.5", referredIp: "27.71.11.5" }).sameIp).toBe(false);
  });
  it("AC8+AC9: gmail-dot + plus-alias family", () => {
    expect(detectFraud({ referrerId: "u1", referredId: "u2", referrerEmail: "john.doe+a@gmail.com", referredEmail: "johndoe+b@gmail.com" }).samePlusAlias).toBe(true);
  });
});

// HTTP-level tests
describe("FR-GROW-001 — referral endpoints", () => {
  it("AC1: GET /v1/me/referral returns refCode + counts", async () => {
    const r = await api.get("/v1/me/referral").as(userA);
    expect(r.body.refCode).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(r.body.refLink).toBe(`https://salenoti.vn/r/${r.body.refCode}`);
  });

  it("AC2: GET /r/<code> sets cookie + 302", async () => {
    const r = await fetch("/r/ab2x9q4Z", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    expect(r.headers.get("set-cookie")).toMatch(/salenoti\.ref=ab2x9q4Z/);
  });

  it("AC5+AC6: qualify + auto-reward chain", async () => {
    const referrer = await seedUser();
    for (let i = 0; i < 3; i++) {
      const invitee = await seedUserWithRef(referrer.refCode);
      await verifyEmail(invitee.id);
      for (let p = 0; p < 3; p++) await trackProduct(invitee.id, p);
    }
    await runQualifyCron();
    const sub = await getSub(referrer.id);
    expect(sub.bonusMonthsRemaining).toBeGreaterThanOrEqual(1);
    const reward = await mongo.db("salenoti").collection("referral_rewards").findOne({ referrerId: referrer._id });
    expect(reward?.reason).toBe("3_qualified_invites");
  });

  it("AC10: rate limit 60/min/IP", async () => {
    for (let i = 0; i < 60; i++) await fetch(`/r/ab2x9q4Z`);
    const r = await fetch(`/r/ab2x9q4Z`);
    expect(r.status).toBe(429);
  });

  it("AC15: bonus cap at 12 months", async () => {
    await seedQualifiedInvites(referrerId, 36);
    await runQualifyCron();
    const sub = await getSub(referrerId);
    expect(sub.bonusMonthsRemaining).toBeLessThanOrEqual(12);
  });
});
```

---

## §6 — Implementation skeleton

See §3 — `ReferralService` + `detectFraud`. Sign-up integration:

```ts
// apps/api/src/auth/sign-in.service.ts (extension)
async onSignInSuccess(user: User, req: Request) {
  const refCookie = parseCookies(req).get("salenoti.ref");
  if (!refCookie || !/^[A-Za-z0-9]{8}$/.test(refCookie)) return;
  if (refCookie === ReferralService.refCodeFor(String(user._id))) {
    posthog.capture("referral_self_referral_blocked", { });
    return;
  }
  await this.referral.onSignup({
    newUserId: String(user._id),
    newUserEmail: user.email,
    newUserIp: req.ip ?? "0.0.0.0",
    refCode: refCookie,
  });
}
```

Qualification check called from FR-WATCH-001 + FR-AUTH-002:

```ts
async function onProductTracked(userId: string) {
  // ... after watchlist insert ...
  await referralService.checkQualification(userId);
}
```

---

## §7 — Dependencies

- **External:** none.
- **Internal:** FR-AUTH-003 (user identity + sign-in flow), FR-BILL-001 (subscriptions.bonusMonthsRemaining consumer), FR-WATCH-001 (track-count threshold for qualification).
- **Infrastructure:** MongoDB with indexed `referrals` + `referral_rewards` collections. Redis for rate limit. PostHog for event capture.
- **Doppler env:** `REFERRAL_SALT` (`openssl rand -hex 32`).

---

## §8 — Example payloads

(see §3 — referral status response + landing 302 + Mongo schemas)

### Referrer's status after 7 invites, 4 qualified, 1 reward

```http
GET /v1/me/referral
→ 200 OK
{
  "refCode": "ab2x9q4Z",
  "refLink": "https://salenoti.vn/r/ab2x9q4Z",
  "invited": 7,
  "qualified": 4,
  "rewardsEarnedMonths": 1
}
```

### `referrals` row (qualified, no fraud)

```json
{
  "_id": "...",
  "referrerId": "65f7...",
  "referredId": "65f8...",
  "refCode": "ab2x9q4Z",
  "status": "qualified",
  "createdAt": "2026-05-10T11:00:00Z",
  "qualifiedAt": "2026-05-13T14:00:00Z",
  "fraudSignals": { "selfRefer": false, "sameIp": false, "samePlusAlias": false, "anyFlag": false }
}
```

### `referrals` row (fraud flagged, pending manual review)

```json
{
  "_id": "...",
  "referrerId": "65f7...",
  "referredId": "65f9...",
  "refCode": "ab2x9q4Z",
  "status": "pending",
  "fraudSignals": { "selfRefer": false, "sameIp": true, "samePlusAlias": false, "anyFlag": true }
}
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Both sides reward (referrer AND referred)?** Resolved → no in P2; just referrer. The invitee gets the value of the product-tracking service itself (the wedge). Adding double-reward at P2 would complicate billing reconciliation; revisit at P3 if viral coefficient k < 0.3.
- **Q2: Manual claim or auto-reward?** Resolved → auto. Friction-free; user delight stays high. Plan §F2 #6 wording ("unlock Pro 1 tháng") implies automatic.
- **Q3: Cap rewards/year?** Resolved → §1 #13 caps at 12 months (1 year). Each reward still needs 3 fresh qualified invites + 90-day window.
- **Q4: Reward redemption — applied to next billing cycle or stacks immediately?** Resolved → stacks via `subscriptions.bonusMonthsRemaining` — FR-BILL-001 consumes on each renewal cycle. A free-tier user accumulates bonuses; once they upgrade to Pro, bonuses front-load.
- **Q5: What if the referrer downgrades to Free (no subscription) mid-cycle?** Resolved → `bonusMonthsRemaining` persists on the subscription record; if user upgrades again, bonuses apply.
- **Q6: How to surface fraud-pending status to user?** Resolved → status shows in `GET /v1/me/referral` as "pending review" (not "qualified"). User-facing copy: "Một số lời mời đang được xem xét — chúng tôi sẽ thông báo khi hoàn tất."

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Bot army using disposable emails | plus-alias + IP detection | fraudSignal flag → manual review hold | AC7 + plan §F2 admin tool review |
| Cookie clobbered by another marketing campaign | last-write-wins | One referral attribution lost | Documented trade-off |
| Reward double-grant race | sequence by mod-3 + count check | One wins per 3-qualified window | AC6 |
| Qualified user pauses watchlists | qualification frozen at the time gates were met | Reward stays | OK (qualification snapshot) |
| Referrer deletes account | refCode orphaned; existing referrals still attributable | OK | None |
| 90-day window edge case | rolling count via `qualifiedAt > now - 90d` | OK | None |
| Fraud false positive (office Wi-Fi) | manual review backlog at P3 | Admin marks qualified | Plan §F2 admin tool needed by 5K MAU |
| Self-referral via fresh device + IP rotation | IP + email-family check | Most caught via device-fingerprint; some escape | Acceptable at MVP; tighten at P3 with FingerprintJS |
| Subscription bonus + paid period overlap | FR-BILL-001 grace logic | Bonus first, then paid | Documented |
| Concurrent qualification of 4th invite when only 3 needed | `maybeReward` modulo-3 check | Only grants 1 per 3 qualified | AC6 |
| `REFERRAL_SALT` rotated | all existing refCodes change; existing referrals still valid (refCode stored in row) | New users get new refCodes; old refLinks become broken | Document rotation runbook; cap to once per year |
| Lazy backfill scan on 100K+ users | linear scan O(N) — acceptable < 10K | Slow at 100K+ | Migrate to indexed `users.refCode` ahead of P3 |
| Cookie size > 4KB (header limits) | refCode is 8 chars; cookie ~30 bytes total | Not at risk | None |
| Bonus cap-12 reached on legitimate power-referrer | user surfaces banner "Cảm ơn — bạn đã đạt giới hạn 12 tháng/year" | Acceptable | Plan §F2 review for VIP tier |

---

## §11 — Notes

- Plan §F2 #6 viral coefficient `k=0.4` target. At 1000 P1 users → P2 should see ~1400 organic + 1000 paid by Phase 2 close. Track via PostHog cohort: % of new signups arriving via `salenoti.ref` cookie.
- The fraud detection at MVP is pragmatic, not bulletproof. A sufficiently motivated attacker with FingerprintJS-evasion + multiple SIM-card mobile data plans + manual gmail signup variations can game it. At MVP this cost is high enough to not be worth a $1.50 Pro month; at P3 we revisit with stricter device fingerprinting.
- The auto-applied bonus (not claim button) is the friction-free pattern. UX: user gets an email "🎉 Bạn vừa unlock 1 tháng Pro miễn phí từ chương trình giới thiệu" with the bonus visible in their next billing cycle.
- Self-referral attempts are NOT recorded as `referrals` rows (they're rejected at the onSignup gate). They're emitted as a PostHog event (`referral_self_referral_blocked`) for monitoring abuse patterns.

---

*End of FR-GROW-001. Status: shipped (2026-05-17). Last expanded: 2026-05-16.*
