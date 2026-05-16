---
id: FR-AUTH-003
title: "JWT session (15-min access + 30-day refresh in HTTP-only cookie) · rotation + reuse-detection · family revoke"
module: AUTH
priority: MUST
status: accepted
verify: T
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Stephen Cheng (Founder + Senior Tech Lead)
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-AUTH-001, FR-AUTH-002, FR-EXT-001, FR-OBS-001, FR-BILL-001, FR-WATCH-001]
depends_on: [FR-AUTH-001]
blocks: [FR-EXT-001, FR-BILL-001, FR-WATCH-001, FR-WATCH-002, FR-NOTIF-001]
effort_hours: 10
template: engineering-spec@1

new_files:
  - apps/web/src/server/auth/session.ts
  - apps/web/src/server/auth/refresh.ts
  - apps/web/src/server/auth/family.ts
  - apps/web/src/app/api/auth/refresh/route.ts
  - apps/web/src/app/api/auth/sign-out/route.ts
  - apps/web/src/app/api/auth/sessions/route.ts
  - apps/web/tests/integration/auth.refresh.spec.ts
  - apps/web/tests/integration/auth.reuse-detection.spec.ts
  - apps/web/tests/integration/auth.cors-extension.spec.ts
modified_files:
  - apps/web/src/auth.ts
  - apps/web/src/middleware.ts
allowed_tools: ["file_read/write apps/web/**", "bash pnpm test"]
disallowed_tools:
  - "store refresh token in localStorage or non-HTTP-only cookie — XSS gives the attacker permanent access"
  - "reuse a rotated refresh token without revoking the entire session family (token-reuse breach detection is the whole point)"
  - "issue access token with TTL > 60 min — defeats the short-lived guarantee"
  - "wildcard CORS for the extension — must pin chrome-extension://<EXT_ID>"
  - "log raw refresh tokens to Sentry/PostHog (full credential leak)"
risk_if_skipped: "Without rotation, a leaked session is permanent until the user manually signs out. Without HTTP-only refresh cookie, the refresh token is accessible to any XSS, making access tokens' short TTL pointless. Plan §D5 binds this. Every downstream API (FR-WATCH-001, FR-BILL-001, etc.) reads the JWT — a faulty auth model corrupts the entire request chain."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The auth service MUST implement a two-token session model with refresh-token rotation and reuse detection.

1. The system MUST issue an access token (JWT signed with `AUTH_SECRET` using HS256) on sign-in completion, with `exp = now + 15 min`, `iat = now`, claims `{ sub: userId, plan, familyId, jti }`. The JWT MUST be stored in `authjs.session-token` HTTP-only `Secure` `SameSite=Lax` cookie with `Max-Age=900` and `Path=/`.
2. The system MUST issue a refresh token: 256-bit random value via `crypto.randomBytes(32).toString("base64url")` (43 chars, URL-safe). The token MUST be stored hashed (SHA-256) in MongoDB `refresh_tokens` collection with document shape:
   ```ts
   { _id, tokenHash, userId, family,
     expiresAt: now + 30d, used: false, usedAt?, rotatedTo?,
     revoked: false, revokedAt?, revokeReason?,
     createdAt, ip_hash, ua_hash, deviceLabel? }
   ```
   The raw token MUST be returned ONLY in the `Set-Cookie: authjs.refresh-token` HTTP-only Secure SameSite=Lax cookie with `Max-Age=2592000` (30 days) and `Path=/api/auth/refresh`. The raw token MUST NEVER be returned in the response body.
3. The endpoint `POST /api/auth/refresh` MUST atomically:
   - Read `authjs.refresh-token` cookie.
   - Compute `hash = sha256(raw)`.
   - Look up row by `{ tokenHash: hash }` within a Mongo transaction.
   - If not found: return 401 `no_token`.
   - If `revoked: true`: return 401 `session_revoked`.
   - If `expiresAt < now`: return 401 `expired`.
   - If `used: true`: **reuse-detection path** — set every row in the same `family` to `{ revoked: true, revokedAt, revokeReason: "reuse_detected" }`, raise Sentry exception with severity `error`, return 401 `reuse_detected`.
   - Otherwise: mark current row `{ used: true, usedAt, rotatedTo: <newHash> }`, insert new refresh row with same `family`, return new access cookie + new refresh cookie with `Set-Cookie` headers.
4. The transaction in §1 #3 MUST use `session.withTransaction()`; the find+update+insert MUST be atomic. If the transaction aborts (concurrent writers), the operation MUST retry once with exponential backoff (50ms→100ms), then fall through to 500.
5. Refresh-token rotation MUST trigger reuse-detection on the SECOND use: the first use marks the original `used: true` and issues new tokens; any subsequent attempt to use the original raw token finds `used: true` and triggers family revocation. This MUST work across all clients sharing that family (web + extension).
6. Both cookies MUST be set with `HttpOnly`, `Secure`, `SameSite=Lax`. The refresh cookie additionally MUST be scoped to `Path=/api/auth/refresh` to limit attack surface (XSS-stolen cookies for `/dashboard` cannot access refresh). The access cookie MUST be scoped to `Path=/`.
7. The `POST /api/auth/refresh` endpoint MUST be rate-limited to `30 req/min/userId` AND `100 req/min/ip` (refresh storm protection). Limit response: 429 with `Retry-After` seconds.
8. The endpoint `POST /api/auth/sign-out` MUST:
   - Verify the access cookie (if present) to extract `familyId`.
   - Mark all rows in the family `{ revoked: true, revokedAt, revokeReason: "user_signout" }`.
   - Clear both cookies via `Set-Cookie: ...; Max-Age=0`.
   - Return 200 even if the cookies were missing (idempotent).
9. The endpoint `GET /api/auth/sessions` MUST list the user's active sessions: `[{ familyId, createdAt, lastRefreshedAt, ip_hash_prefix, ua_summary, current: bool }]`. PII (IP, UA) MUST be redacted to hash prefix + parsed UA summary (browser/OS), never raw.
10. The endpoint `DELETE /api/auth/sessions/:familyId` MUST revoke a specific session family (per-device sign-out). The user MUST be authenticated; the family MUST belong to the user.
11. Browser-extension session sync (FR-EXT-001) MUST be supported via CORS:
    - The endpoint MUST respond to OPTIONS preflight with `Access-Control-Allow-Origin: chrome-extension://<EXT_ID>` (the production extension ID set in `EXT_ID` env var).
    - `Access-Control-Allow-Credentials: true` MUST be set.
    - `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`.
    - Wildcard `*` MUST NOT be used; only the pinned EXT_ID origin is allowed.
12. The system MUST emit audit events:
    - PostHog `auth_session_created` on sign-in (FR-AUTH-001/002 emits).
    - PostHog `auth_session_refreshed` on each rotation (with `family_age_days`).
    - PostHog `auth_session_revoked` on sign-out (with `reason`).
    - Sentry `auth_reuse_detected` as `level: "error"` on family revocation (with `family`, `userId: hashed`, `triggeredFromIp_hash_prefix`).
    - The audit chain MUST include `correlationId` linking refresh → access events.
13. The latency p95 for `POST /api/auth/refresh` MUST be < 150 ms (Atlas SG region under normal conditions).
14. Access-token verification MUST tolerate ±60s clock skew (`iat` and `exp` checks). This prevents legitimate edge clients with slightly drifted clocks from being rejected.
15. The `AUTH_SECRET` rotation MUST support N-1 acceptance: both the current and previous secret MUST verify access tokens for a 1-hour grace window after rotation. The current secret signs new tokens; the previous secret only verifies. After 1h, expired-tokens with the old secret fail validation (forcing refresh, which uses the new secret).
16. The `refresh_tokens` collection MUST have a TTL index on `expiresAt` (auto-delete after expiry + 30-day buffer for audit forensics). Revoked rows MUST be retained until TTL expiry, NOT deleted on revoke (audit trail).

---

## §2 — Why this design

**Why 15 min + 30 d (not 1h + 7d, not 5m + 90d):** Industry standard from Okta, Auth0, Clerk research. Access tokens short enough that revoke-on-sign-out propagates within 15 min worst-case (since stale access tokens stay valid until they naturally expire). Refresh long enough that "every two weeks I have to sign in" UX is avoided (median session for B2C tools is 7-10 days; 30 covers it comfortably). 5-min access tokens would create excessive refresh churn at scale (every API request would refresh).

**Why rotation with reuse-detection:** OAuth 2.1 §6.2 + RFC 6819 §5.2.2. If an attacker steals a refresh token (e.g., via XSS that found a way around HttpOnly, or device theft), the legitimate user's next refresh will trigger reuse-detection (their original token is now `used: true` from the attacker's earlier use). Either:
- (a) The attacker uses the stolen token first, then the user's legitimate refresh triggers reuse-detection and revokes the family — attacker's session and user's session both invalidated. User notices and re-authenticates.
- (b) The user refreshes first, then the attacker's later use triggers reuse-detection — attacker's session immediately killed.

Either outcome is good. Without reuse-detection, the attacker has 30 days of stolen access.

**Why HTTP-only + path-scoped:** Refresh tokens are the prize. `HttpOnly` blocks JS access (any XSS-via-bug or supply-chain compromise can't read them). `Path=/api/auth/refresh` means the browser only sends them to that one endpoint — so XSS on `/dashboard` or `/billing/*` doesn't trigger sending the refresh cookie to those endpoints (and any rogue endpoint can't capture it).

**Why hash not raw in DB:** defense-in-depth. If `refresh_tokens` is compromised (DB dump, backup exfiltration, insider), the attacker gets hashes — useless for impersonation without rainbow tables, which fail against 256-bit random tokens (search space 2^256). Raw tokens never persist past the response.

**Why explicit `Access-Control-Allow-Origin: chrome-extension://<id>` pinning:** Chrome extensions present a fixed origin like `chrome-extension://abcdef123...`. Wildcard CORS (`*`) would also send credentials to any extension, allowing a malicious extension installed on the user's browser to impersonate the user against our API. Pinning the production EXT_ID lets only our extension authenticate.

**Why per-family revocation (not per-token):** a "session family" = one sign-in event and all its rotated descendants. When reuse-detection fires, we don't know which descendant the attacker has; revoking the whole family is the safe default. The user signs in again, gets a new family, and old chains can't extend.

**Why N-1 secret acceptance for AUTH_SECRET rotation:** without N-1, rotating the secret instantly invalidates every active access token, forcing every user to refresh simultaneously — a "refresh storm" that could spike DB load and rate-limit users out. With N-1, rotation is a smooth transition over 1 hour.

**Why clock-skew tolerance ±60s:** edge-deployed clients (extension on user's laptop, mobile browsers on flaky time) sometimes have clocks off by 30-60 seconds. Strict `exp` comparison rejects valid tokens at the boundary. ±60s leeway is the practical sweet spot — generous enough for real drift, tight enough that compromised credentials don't get a longer effective lifetime.

**Why `GET /api/auth/sessions` (multi-device visibility):** users increasingly expect to see "where am I signed in" lists (Google, Twitter, GitHub all have this). It's also a security feature — a user noticing an unfamiliar session can revoke it via `DELETE /:familyId`. Free feature, high trust value.

**Why audit on Sentry AND PostHog:** Sentry for incident response (`reuse_detected` is a security event, needs alerting); PostHog for analytics (`session_refreshed` count + `family_age_days` for UX dashboards). The two have different consumers; dual emission is intentional.

---

## §3 — API contract

### Refresh

```http
POST /api/auth/refresh
Cookie: authjs.refresh-token=N5_q2x...

→ 200 OK
Set-Cookie: authjs.session-token=eyJhbGciOiJI...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900
Set-Cookie: authjs.refresh-token=8f3kQp...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=2592000
{ "ok": true, "expiresIn": 900 }

→ 401 if no cookie
{ "error": "no_token" }

→ 401 if expired (normal expiry, no family revoke)
{ "error": "expired" }

→ 401 if reuse detected (family revoked)
{ "error": "reuse_detected", "message": "Session revoked due to suspicious activity. Please sign in again." }
```

### Sign-out (single device)

```http
POST /api/auth/sign-out
Cookie: authjs.session-token=...; authjs.refresh-token=...

→ 200 OK
Set-Cookie: authjs.session-token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0
Set-Cookie: authjs.refresh-token=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=0
{ "ok": true }
```

### List sessions

```http
GET /api/auth/sessions
Authorization: Bearer <access>

→ 200 OK
{
  "sessions": [
    { "familyId": "01J9Z...", "createdAt": "...", "lastRefreshedAt": "...", "ip_hash_prefix": "ab12", "ua_summary": "Chrome 124 on macOS", "current": true },
    { "familyId": "01K2A...", "createdAt": "...", "lastRefreshedAt": "...", "ip_hash_prefix": "cd34", "ua_summary": "Chrome Extension", "current": false }
  ]
}
```

### Revoke specific session

```http
DELETE /api/auth/sessions/01K2A...
Authorization: Bearer <access>

→ 200 OK
{ "revoked": true }

→ 404 if family not found or not owned by user
```

### CORS for extension

```http
OPTIONS /api/auth/refresh
Origin: chrome-extension://<EXT_ID>
Access-Control-Request-Method: POST

→ 204
Access-Control-Allow-Origin: chrome-extension://<EXT_ID>
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 600
```

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | valid refresh cookie | POST /api/auth/refresh | 200; both cookies rotated; p95 < 150ms; PostHog `auth_session_refreshed` |
| AC2 | missing refresh cookie | POST /api/auth/refresh | 401 `no_token`; no DB change |
| AC3 | refresh expired (created 31d ago, no use) | POST /api/auth/refresh | 401 `expired`; family NOT revoked (normal expiry) |
| AC4 | already-used refresh token | POST /api/auth/refresh | 401 `reuse_detected`; entire family `revoked: true`; Sentry `error` event with `kind: "reuse_detected"` |
| AC5 | user has revoked family | call any authenticated API | 401 `session_revoked`; client redirects to /auth/signin |
| AC6 | sign-out | POST /api/auth/sign-out | 200; both cookies cleared (Max-Age=0); family revoked in DB |
| AC7 | 31 refresh calls/min from same user | POST | 31st returns 429 with Retry-After |
| AC8 | OPTIONS preflight from `chrome-extension://<EXT_ID>` | OPTIONS /api/auth/refresh | 204 with `Access-Control-Allow-Origin: chrome-extension://<EXT_ID>` |
| AC9 | OPTIONS from `chrome-extension://malicious` | OPTIONS /api/auth/refresh | 204 with NO Access-Control headers; browser blocks |
| AC10 | inspect `refresh_tokens` row after rotation | mongo find | only `tokenHash` field, never raw token |
| AC11 | clock skew +45s on client | verify access token | accepted (within ±60s leeway) |
| AC12 | clock skew +90s on client | verify access token | rejected |
| AC13 | AUTH_SECRET rotated | old token issued under previous secret | verifies within 1h N-1 window; rejected after |
| AC14 | GET /api/auth/sessions | authenticated user | lists all active families with `current: true` flagged |
| AC15 | DELETE /api/auth/sessions/<otherFamily> | authenticated user | other family revoked; current family unaffected |
| AC16 | DELETE /api/auth/sessions/<otherUserFamily> | authenticated user | 404 (not owned) |
| AC17 | concurrent rotations of same token | 2 parallel POST /refresh with same cookie | one wins, second 401 `reuse_detected` (atomic txn ensures one wins) |
| AC18 | rotation creates new family member | inspect DB after rotation | new row inserted with same `family`, original marked `used: true` with `rotatedTo` set to new hash |
| AC19 | raw refresh token never in response body | inspect POST /refresh response | `Set-Cookie` only; body is `{ok, expiresIn}` |
| AC20 | reuse-detected event in Sentry context | parse Sentry event | no raw token, no email; `family` ID, `userId: hashed`, `triggeredFromIp_hash_prefix` only |

---

## §5 — Verification

```ts
// apps/web/tests/integration/auth.refresh.spec.ts
describe("FR-AUTH-003 — JWT session + rotation", () => {
  beforeEach(async () => { await mongo.db("salenoti").collection("refresh_tokens").deleteMany({}); });

  it("AC1: refresh rotates both cookies", async () => {
    const { session, refresh } = await signInGoogle("u@x.com");
    const r = await request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post();
    expect(r.status).toBe(200);
    expect(r.cookies["authjs.session-token"]).not.toBe(session);
    expect(r.cookies["authjs.refresh-token"]).not.toBe(refresh);
    expect(r.cookies["authjs.session-token"]).toMatch(/HttpOnly; Secure; SameSite=Lax; Path=\/;/);
    expect(r.cookies["authjs.refresh-token"]).toMatch(/Path=\/api\/auth\/refresh/);
    expect(posthogMock.events).toContainEqual(expect.objectContaining({ event: "auth_session_refreshed" }));
  });

  it("AC2: missing cookie", async () => {
    const r = await request("/api/auth/refresh").post();
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("no_token");
  });

  it("AC3: normal expiry doesn't revoke family", async () => {
    const { refresh, family } = await signInGoogle("u@x.com");
    await mongo.db("salenoti").collection("refresh_tokens").updateOne({ family }, { $set: { expiresAt: new Date(Date.now() - 86400_000) } });
    const r = await request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post();
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("expired");
    const rows = await mongo.db("salenoti").collection("refresh_tokens").find({ family }).toArray();
    expect(rows.every(r => !r.revoked)).toBe(true);
  });

  it("AC4: replay attack — second use of same refresh revokes family + Sentry", async () => {
    const { refresh, family } = await signInGoogle("u@x.com");
    await request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post(); // legit
    sentryMock.reset();
    const replay = await request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post();
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("reuse_detected");
    expect(sentryMock.captures).toContainEqual(expect.objectContaining({
      level: "error",
      tags: expect.objectContaining({ fr: "FR-AUTH-003", kind: "reuse_detected" }),
    }));
    const family_rows = await mongo.db("salenoti").collection("refresh_tokens").find({ family }).toArray();
    expect(family_rows.every(r => r.revoked)).toBe(true);
  });

  it("AC8+AC9: CORS — only pinned extension allowed", async () => {
    const allowed = await request("/api/auth/refresh", { headers: { Origin: `chrome-extension://${process.env.EXT_ID}`, "Access-Control-Request-Method": "POST" } }).options();
    expect(allowed.headers["access-control-allow-origin"]).toBe(`chrome-extension://${process.env.EXT_ID}`);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const blocked = await request("/api/auth/refresh", { headers: { Origin: "chrome-extension://malicious", "Access-Control-Request-Method": "POST" } }).options();
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("AC10: DB never stores raw token", async () => {
    const { refresh } = await signInGoogle("u@x.com");
    const allRows = await mongo.db("salenoti").collection("refresh_tokens").find({}).toArray();
    const rawHash = crypto.createHash("sha256").update(refresh).digest("hex");
    expect(allRows.some(r => r.tokenHash === rawHash)).toBe(true);
    expect(JSON.stringify(allRows)).not.toContain(refresh); // raw form never persists
  });

  it("AC11+AC12: clock-skew tolerance ±60s", async () => {
    const access = signAccessToken({ userId: "u1", familyId: "f1", iat: Math.floor(Date.now() / 1000) - 30 });
    expect(verifyAccessToken(access)).toBeTruthy();
    const tooFuture = signAccessToken({ userId: "u1", familyId: "f1", iat: Math.floor(Date.now() / 1000) + 90 });
    expect(verifyAccessToken(tooFuture)).toBeNull();
  });

  it("AC13: AUTH_SECRET N-1 acceptance", async () => {
    const oldSecret = process.env.AUTH_SECRET;
    const access = signAccessToken({ userId: "u1", familyId: "f1" }, oldSecret!);
    process.env.AUTH_SECRET = "new-secret-rotated";
    process.env.AUTH_SECRET_N_MINUS_1 = oldSecret;
    expect(verifyAccessToken(access)).toBeTruthy(); // accepted via N-1
    advanceTime(61 * 60_000);
    expect(verifyAccessToken(access)).toBeNull();
  });

  it("AC14+AC15: list & revoke sessions", async () => {
    const { family: f1 } = await signInGoogle("u@x.com");
    const { family: f2, refresh: r2 } = await signInGoogle("u@x.com");
    const list = await request("/api/auth/sessions", { cookies: ... }).get();
    expect(list.body.sessions).toHaveLength(2);
    const revoke = await request(`/api/auth/sessions/${f1}`).delete();
    expect(revoke.status).toBe(200);
    const after = await mongo.db("salenoti").collection("refresh_tokens").findOne({ family: f1 });
    expect(after!.revoked).toBe(true);
  });

  it("AC17: concurrent rotations — one wins", async () => {
    const { refresh } = await signInGoogle("u@x.com");
    const [r1, r2] = await Promise.all([
      request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post(),
      request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post(),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 401]);
  });

  it("AC20: Sentry capture excludes PII", async () => {
    const { refresh } = await signInGoogle("u@x.com");
    await request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post();
    sentryMock.reset();
    await request("/api/auth/refresh", { cookies: { "authjs.refresh-token": refresh } }).post();
    const capture = sentryMock.captures[0];
    const json = JSON.stringify(capture);
    expect(json).not.toContain(refresh);            // no raw token
    expect(json).not.toContain("u@x.com");          // no email
    expect(capture.tags).toHaveProperty("family");
    expect(capture.tags.userId).toMatch(/^[a-f0-9]{12}$/); // hashed
  });
});
```

---

## §6 — Implementation skeleton

```ts
// apps/web/src/server/auth/session.ts
import jwt from "jsonwebtoken";
import { ulid } from "ulid";

export type AccessClaims = { sub: string; plan: string; familyId: string; jti: string };

export function signAccessToken(payload: { userId: string; plan: string; familyId: string }, secret = process.env.AUTH_SECRET!): string {
  return jwt.sign(
    { sub: payload.userId, plan: payload.plan, familyId: payload.familyId, jti: ulid() },
    secret,
    { algorithm: "HS256", expiresIn: "15m", issuer: "salenoti", audience: "salenoti-api" }
  );
}

export function verifyAccessToken(token: string): AccessClaims | null {
  const candidates = [process.env.AUTH_SECRET!, process.env.AUTH_SECRET_N_MINUS_1].filter(Boolean) as string[];
  for (const secret of candidates) {
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: "salenoti", audience: "salenoti-api", clockTolerance: 60 });
      return decoded as AccessClaims;
    } catch { /* try next */ }
  }
  return null;
}

// apps/web/src/server/auth/refresh.ts
import crypto from "node:crypto";
import { mongo } from "@/server/db/mongo";
import * as Sentry from "@sentry/nextjs";
import { signAccessToken } from "./session";

export async function rotateRefresh(rawRefresh: string, ctx: { ip: string; ua: string }): Promise<RotateResult> {
  const hash = sha256(rawRefresh);
  const client = mongo.getClient();
  const session = client.startSession();
  try {
    return await withRetry(2, async () => {
      return await session.withTransaction(async () => {
        const col = mongo.db("salenoti").collection("refresh_tokens");
        const row = await col.findOne({ tokenHash: hash }, { session });
        if (!row) return { ok: false as const, code: "no_token" };
        if (row.revoked) return { ok: false as const, code: "session_revoked" };
        if (row.expiresAt < new Date()) return { ok: false as const, code: "expired" };
        if (row.used) {
          await col.updateMany(
            { family: row.family },
            { $set: { revoked: true, revokedAt: new Date(), revokeReason: "reuse_detected" } },
            { session }
          );
          await session.commitTransaction();
          Sentry.captureException(new Error("auth_reuse_detected"), {
            level: "error",
            tags: { fr: "FR-AUTH-003", kind: "reuse_detected", family: row.family, userId: hashUserId(row.userId), triggeredFromIp_hash_prefix: sha256(ctx.ip + process.env.IP_SALT).slice(0, 8) },
          });
          posthog.capture({ event: "auth_session_revoked", properties: { reason: "reuse_detected", family: row.family, userId: hashUserId(row.userId) } });
          return { ok: false as const, code: "reuse_detected" };
        }
        const newRaw = crypto.randomBytes(32).toString("base64url");
        const newHash = sha256(newRaw);
        await col.updateOne(
          { _id: row._id },
          { $set: { used: true, usedAt: new Date(), rotatedTo: newHash } },
          { session }
        );
        await col.insertOne({
          tokenHash: newHash, userId: row.userId, family: row.family,
          expiresAt: new Date(Date.now() + 30 * 86400_000),
          used: false, revoked: false, createdAt: new Date(),
          ip_hash: sha256(ctx.ip + process.env.IP_SALT).slice(0, 16),
          ua_hash: sha256(ctx.ua + process.env.UA_SALT).slice(0, 12),
        }, { session });
        const user = await mongo.db("salenoti").collection("users").findOne({ _id: row.userId }, { session });
        const access = signAccessToken({ userId: row.userId, plan: user!.plan, familyId: row.family });
        return { ok: true as const, access, refreshRaw: newRaw, familyAgeDays: Math.floor((Date.now() - row.createdAt.getTime()) / 86400_000) };
      });
    });
  } finally {
    await session.endSession();
  }
}

function sha256(s: string): string { return crypto.createHash("sha256").update(s).digest("hex"); }

async function withRetry<T>(maxAttempts: number, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); } catch (e: any) {
      if (i === maxAttempts - 1) throw e;
      await new Promise(r => setTimeout(r, 50 * Math.pow(2, i)));
    }
  }
  throw new Error("unreachable");
}

// apps/web/src/app/api/auth/refresh/route.ts
export async function POST(req: NextRequest) {
  const cookies = parseCookies(req);
  const raw = cookies["authjs.refresh-token"];
  if (!raw) return json({ error: "no_token" }, 401);
  const ctx = { ip: req.headers.get("x-real-ip") ?? "", ua: req.headers.get("user-agent") ?? "" };
  const result = await rotateRefresh(raw, ctx);
  if (!result.ok) return json({ error: result.code }, 401);
  const res = NextResponse.json({ ok: true, expiresIn: 900 });
  res.cookies.set("authjs.session-token", result.access, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 900 });
  res.cookies.set("authjs.refresh-token", result.refreshRaw, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth/refresh", maxAge: 30 * 86400 });
  posthog.capture({ event: "auth_session_refreshed", properties: { family_age_days: result.familyAgeDays } });
  return res;
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  if (origin === `chrome-extension://${process.env.EXT_ID}`) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      },
    });
  }
  return new NextResponse(null, { status: 204 });
}
```

---

## §7 — Dependencies

- FR-AUTH-001 (Google OAuth lands first, creates first refresh row + family on sign-in)
- FR-AUTH-002 (Magic-link similarly creates initial refresh row)
- FR-EXT-001 (extension calls `/api/auth/refresh` with credentials; pinned-ID CORS)
- FR-OBS-001 (Sentry + PostHog event capture, beforeSend PII redaction)
- MongoDB Atlas with transaction support (M0 single-shard or M10+ replica set)
- Doppler env: `AUTH_SECRET` (≥ 32 chars), `AUTH_SECRET_N_MINUS_1` (during rotation only), `EXT_ID` (Chrome extension production ID)
- `jsonwebtoken@^9` for JWT sign/verify; `ulid` for `jti` generation

Migration:
```ts
await db.collection("refresh_tokens").createIndex({ tokenHash: 1 }, { unique: true });
await db.collection("refresh_tokens").createIndex({ userId: 1, family: 1 });
await db.collection("refresh_tokens").createIndex({ family: 1 });
await db.collection("refresh_tokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 30 * 86400 }); // TTL with 30d buffer
```

---

## §8 — Example payloads

### Set-Cookie shape (browser dev tools)

```
authjs.session-token=eyJhbGciOiJI...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900
authjs.refresh-token=N5_q2x...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=2592000
```

### `refresh_tokens` row after rotation (the original)

```json
{
  "_id": "65f...",
  "tokenHash": "ab23ee...",
  "userId": "65f7...",
  "family": "01J9Z...",
  "expiresAt": "2026-06-15T00:00:00Z",
  "used": true,
  "usedAt": "2026-05-16T11:00:00Z",
  "rotatedTo": "ee15ff...",
  "revoked": false,
  "createdAt": "2026-05-16T10:00:00Z",
  "ip_hash": "27a1b2c3...",
  "ua_hash": "f4d5e6..."
}
```

### Reuse-detected Sentry event (sanitized)

```json
{
  "level": "error",
  "message": "auth_reuse_detected",
  "tags": {
    "fr": "FR-AUTH-003",
    "kind": "reuse_detected",
    "family": "01J9Z...",
    "userId": "ab12cd34ef56",
    "triggeredFromIp_hash_prefix": "9a8b7c6d"
  }
}
```

---

## §9 — Open questions (resolved)

**Q1: Pure JWT or DB-backed sessions?**
A: Hybrid. JWT for access (cheap, short TTL, no DB hit on every request); DB row only for refresh chain (must support revoke). Best of both.

**Q2: 7 d or 30 d refresh?**
A: 30 days. UX balance — median consumer-app session is 7-10 days; 30 covers it comfortably. Rotation + reuse-detection makes 30 d safe even if a token leaks.

**Q3: Revoke all sessions on password change?**
A: Out of scope — sale-noti P0 has no password (Google OAuth + magic link only). Revisit if password auth is added later.

**Q4: How does the extension get a refresh cookie if it never visits salenoti.vn directly?**
A: FR-EXT-001 §1 #5 opens an OAuth popup to `sale.cyber.skill/auth/sign-in?ext=1` on first install. Both cookies are set on that response and persist for cross-origin requests when the extension uses `credentials: "include"` with the pinned-ID CORS.

**Q5: Should we tie `familyId` to `deviceId`?**
A: Not at MVP. Family = sign-in event; multiple sign-ins on the same device get separate families (intentional — explicit re-auth). P3 may add device fingerprinting if abuse patterns emerge.

**Q6: What about WebAuthn / passkeys?**
A: P3. Adds passwordless second-factor without changing the session model — passkeys produce sign-in events that create new families.

**Q7: How are stolen access tokens (15-min window) handled?**
A: Limited blast radius by design (15 min). Sign-out revokes the family, which means the access token still works until natural expiry but the refresh can't extend. We accept the 15-min window as the cost of avoiding per-request DB lookups for revocation.

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Refresh cookie missing | row not found | 401 `no_token` | sign in again | info |
| 2 | Refresh expired (normal) | `expiresAt < now`, `used: false` | 401 `expired` | sign in again | info |
| 3 | Reuse detected (theft) | `used: true` already + new use | 401 + revoke family + Sentry alert | user re-authenticates; P2 sends notification email about suspicious activity | error |
| 4 | Family revoked (explicit sign-out) | `revoked: true` | 401 `session_revoked` | sign in again | info |
| 5 | Mongo transaction abort | concurrent writer | retry once, then 500 | client retries; if persists, surface 500 | warning |
| 6 | `AUTH_SECRET` rotated mid-session | old JWT fails verify on new secret | N-1 acceptance for 1h | clients pull new token via refresh; old access dies naturally at 15-min | info |
| 7 | Rate-limit triggered | 31st refresh in 60s | 429 | client back-off; suspicious if persistent | warning |
| 8 | CORS preflight from unknown origin | no allow-origin header | browser blocks request | by design — no remediation | info |
| 9 | Atlas slowdown | refresh > 150ms p95 | OBS alert | investigate; check Atlas health; consider read-from-secondary | warning |
| 10 | Clock skew > ±60s | client clock badly off | access rejected; client re-sync NTP | extension shows "system clock seems off" hint; rare | warning |
| 11 | Concurrent refresh from web + extension (same family, parallel) | both POST /refresh same time | transaction serializes; one wins, the other gets `reuse_detected` (its token is the one that became `used: true` first) | both sign in again — annoying but rare | warning |
| 12 | Cookie size growth (very long JWT) | future plan claim bloat | monitor average cookie size | keep JWT claims minimal (sub, plan, familyId, jti); plan changes via /me endpoint | info |
| 13 | Mongo replica failover during rotation | transaction aborts | retry path catches | one retry, then 500; rare | info |
| 14 | Cross-site request forgery (CSRF) | malicious site triggers /refresh | SameSite=Lax + path-scoped cookie limits exposure; no body-based state mutation | accepted exposure within Lax semantics | info |
| 15 | Extension EXT_ID rotated (Chrome Web Store) | dev cycle | update Doppler `EXT_ID`; users re-auth | rare; planned during extension version bump | warning |
| 16 | Sentry captures leak raw token | bad refactor | unit test asserts capture contents | AC20 verifies; CI gate | error |
| 17 | TTL index purges revoked row mid-audit | rare | 30d buffer past expiry covers forensic window | accepted; aggregate audit stats persisted separately if needed | info |

---

## §11 — Notes

- We deliberately do NOT implement "remember-me toggle"; refresh is always 30 d. Less surface, simpler UX, lower support cost.
- Browser-extension session sync is the part most likely to need iteration. Plan §H Risk Matrix flags Chrome Web Store reject. Keep CORS pinning + manifest in sync; integration test in FR-EXT-001 covers it end-to-end.
- Once mobile (P3) ships, the refresh model carries over unchanged — same `refresh_tokens` collection, just additional family entries per device.
- The `jti` (JWT ID, ULID) in access tokens enables future per-token revocation (P3 if needed); MVP doesn't use it but the field is reserved.
- The N-1 secret acceptance window (1 hour) is short by design — long enough to roll out a deploy without forcing all users to refresh simultaneously, short enough that a leaked old secret can't be exploited beyond the window.
- `correlationId` for cross-event linking is set per-refresh-chain (not per-token); it lets us trace a single sign-in's full lifecycle in PostHog.
- Multi-device session list (`GET /api/auth/sessions`) is a security feature AND a trust feature — users seeing "Chrome on macOS · 2 hours ago · current" know we're not lying about who's signed in.

---

*FR-AUTH-003 spec — last revised 2026-05-16. Status: accepted (10/10).*
