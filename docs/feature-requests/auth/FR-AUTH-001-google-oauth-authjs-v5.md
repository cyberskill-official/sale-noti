---
id: FR-AUTH-001
title: "Google OAuth via Auth.js v5.0.0-beta.25 (pinned, no `latest`)"
module: AUTH
priority: MUST
status: done
shipped: 2026-05-17
verify: T
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Stephen Cheng (Founder + Senior Tech Lead)
created: 2026-05-16
related_frs: [FR-AUTH-002, FR-AUTH-003]
depends_on: []
blocks: [FR-AUTH-002, FR-AUTH-003, FR-WATCH-001, FR-EXT-001, FR-BILL-001]
effort_hours: 6

new_files:
  - apps/web/package.json
  - apps/web/src/auth.ts
  - apps/web/src/middleware.ts
  - apps/web/src/app/api/auth/[...nextauth]/route.ts
  - apps/web/.env.example
  - apps/web/tests/integration/auth.google.spec.ts
modified_files:
  - apps/web/next.config.mjs
allowed_tools:
  - "file_read/write apps/web/**"
  - "bash pnpm install"
  - "bash pnpm test"
  - "bash pnpm typecheck"
disallowed_tools:
  - "use `next-auth@latest` or `@auth/core@latest` (forbidden by plan §C8)"
  - "store refresh token in `localStorage` or non-HTTP-only cookie"
  - "log raw Google ID token to Sentry/PostHog"
risk_if_skipped: "Without pinned Auth.js v5 and Google OAuth, every other FR is blocked — there is no user identity to attach a watchlist, affiliate sub-id, or billing record to. Using `latest` re-introduces the pre-1.0 API drift risk that plan §C8 calls out (Auth.js v5 has been in beta for >12 months; minor versions ship breaking changes regularly)."
---

## §1 — Description (BCP-14 normative)

The web app MUST implement Google OAuth sign-in via Auth.js v5 at the version pinned in §3.

1. **MUST** install `next-auth@5.0.0-beta.25` exactly (no `^`, no `~`, no `latest`) in `apps/web/package.json`. Use `pnpm add next-auth@5.0.0-beta.25 --save-exact`.
2. **MUST** configure `Auth({ providers: [Google({ clientId, clientSecret })], ... })` in `apps/web/src/auth.ts` per the canonical Auth.js v5 contract.
3. **MUST** route `GET|POST /api/auth/[...nextauth]` through the Auth.js handler exported from `auth.ts`.
4. **MUST** request only the OAuth scopes `openid email profile` (no Drive, no Calendar — least-privilege).
5. **MUST** redirect post-sign-in to `/dashboard` for new and returning users; never to an absolute URL provided in the request (open-redirect guard).
6. **MUST** persist the user to MongoDB `users` collection on first sign-in via the Auth.js `signIn` callback with the schema in §3 (fields: `_id`, `email`, `oauthProviders[]`, `plan`, `notificationChannels`, `createdAt`).
7. **MUST** fail closed: if `users` upsert errors, the sign-in flow returns `403` with code `USER_UPSERT_FAILED` and emits a Sentry event. No half-authenticated session is allowed.
8. **MUST** validate the Google `iss` claim is exactly `https://accounts.google.com` (or `accounts.google.com`) and the `aud` claim equals `GOOGLE_CLIENT_ID`. Reject otherwise.
9. **MUST** read `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from Doppler-mounted env (plan §D5 secret management). They MUST NOT appear in `.env`, `.env.local`, `.env.production`, or any committed file.
10. **MUST** complete a successful sign-in round-trip in < 800 ms p95 measured client→Auth.js callback→MongoDB upsert→302 to `/dashboard` (with prod-like network latency to Atlas SG region).
11. **MUST** emit the Sentry breadcrumb `auth.google.sign_in.{started,succeeded,failed}` and the PostHog event `auth_sign_in` with property `method: "google"`.
12. **MUST** rate-limit `POST /api/auth/callback/google` to 10 req/min/IP via `@nestjs/throttler` (or Next equivalent middleware) to block credential-stuffing scans.

---

## §2 — Why this design

**Why Auth.js v5 (not v4 stable, not Clerk, not Lucia):** plan §C8 mandates Auth.js v5 + `risk-managed` posture. The team standardised on the Next.js App Router stack; Auth.js v5 is the canonical pairing for App Router + RSC. Clerk imposes vendor lock-in + pricing surprises; Lucia is too low-level to ship in 6 weeks with two interns. Auth.js v4 is going EOL.

**Why pin to `5.0.0-beta.25` exact:** the beta train has shipped breaking API changes every 2–4 minor versions for the last 14 months (cf. GitHub release notes for `next-auth`). Plan §C8 explicitly forbids `latest`. We re-evaluate the pin every quarter or on stable v5.0.0 release.

**Why Google OAuth as primary (not Facebook/Zalo):** plan §F1 personas show 35% Gen-Z + 25% Mẹ bỉm sữa target; both groups have ~95% Google account penetration in VN. Facebook Login is on the P3 roadmap. Zalo OAuth requires a Vietnamese business entity registration step we cover under FR-LEGAL-001; once that lands we revisit (P2).

**Why `openid email profile` only:** least-privilege per Google's OAuth review guidelines. No `drive.readonly`, no `calendar`. Reduces verification burden on Google's brand-protection process from "sensitive" to "non-sensitive scopes" — same-day approval vs 2–6 weeks.

**Why fail-closed on `users` upsert:** plan §B3 PDPL Art. 24 requires DPIA proof of data flow control. A half-authenticated session (Google JWT validated, but user not in our DB) is a fingerprint-able security gap. Better to 403 and surface than to silently let the user through.

---

## §3 — API contract & code shape

### `apps/web/src/auth.ts`

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { upsertUserOnSignIn } from "./server/users/upsert-on-signin";

const env = z
  .object({
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    AUTH_SECRET: z.string().min(32),
  })
  .parse(process.env);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 15 /* 15 min, refresh in FR-AUTH-003 */ },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      if (profile?.iss !== "https://accounts.google.com" &&
          profile?.iss !== "accounts.google.com") return false;
      if (profile?.aud !== env.GOOGLE_CLIENT_ID) return false;
      const result = await upsertUserOnSignIn(profile);
      if (!result.ok) return `/auth/error?code=USER_UPSERT_FAILED&trace=${result.traceId}`;
      return true;
    },
    async redirect({ url, baseUrl }) {
      // Open-redirect guard
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return `${baseUrl}/dashboard`;
    },
  },
  pages: { signIn: "/auth/sign-in", error: "/auth/error" },
});
```

### `apps/web/src/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
export const runtime = "nodejs"; // not edge — MongoDB driver needed
```

### MongoDB `users` collection schema (slice of plan §C3 — full schema in FR-AUTH-002)

```ts
{
  _id: ObjectId,
  email: string,                                       // unique index
  oauthProviders: [{ provider: "google", providerAccountId: string }],
  passwordHash: null,                                  // populated only if magic-link auth used
  plan: "free",                                        // default
  notificationChannels: { email: true, webPush: false, telegram: false },
  createdAt: Date,
  updatedAt: Date,
}
// Indexes: { email: 1 } unique, { "oauthProviders.providerAccountId": 1 }
```

---

## §4 — Acceptance criteria

1. Fresh user clicks "Sign in with Google" → Google consent → returns to `/dashboard` in < 800 ms p95, with a `users` row created and `sessionToken` cookie set (HTTP-only, Secure, SameSite=Lax).
2. Returning user (already in `users`) → same flow → `users.updatedAt` bumped; no new row created.
3. Google returns invalid `iss` claim → sign-in rejected; user lands on `/auth/error?code=invalid_issuer`.
4. Google returns invalid `aud` claim → sign-in rejected; user lands on `/auth/error?code=invalid_audience`.
5. MongoDB upsert throws → sign-in rejected; `/auth/error?code=USER_UPSERT_FAILED&trace=<id>`; Sentry event captured with the trace id; PostHog event `auth_sign_in` carries `outcome: "failed"`.
6. Open-redirect attempt (`?callbackUrl=https://evil.com/`) → user redirected to `/dashboard` instead.
7. > 10 callback hits/min from same IP → 11th returns 429 with `Retry-After`.
8. Inspecting `package.json` shows `"next-auth": "5.0.0-beta.25"` (exact, no range prefix).
9. `pnpm typecheck && pnpm test integration/auth.google` is green.
10. `grep -RE '(GOOGLE_CLIENT_SECRET|AUTH_SECRET)' apps/web --exclude-dir=node_modules` returns zero hits in tracked files.

---

## §5 — Verification

```ts
// apps/web/tests/integration/auth.google.spec.ts
import { describe, it, expect } from "vitest";
import { mockGoogleProvider } from "../helpers/mock-google";
import { request } from "../helpers/http";
import { getUserByEmail } from "../helpers/mongo";

describe("FR-AUTH-001 — Google OAuth via Auth.js v5", () => {
  it("AC1: new user round-trip < 800ms, users row created", async () => {
    mockGoogleProvider({ email: "newuser@example.com", iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID! });
    const t0 = Date.now();
    const res = await request("/api/auth/callback/google").post({ code: "fake-code", state: "csrf" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/dashboard");
    expect(res.headers["set-cookie"].some((c: string) => /HttpOnly;.*Secure;.*SameSite=Lax/.test(c))).toBe(true);
    expect(Date.now() - t0).toBeLessThan(800);
    expect(await getUserByEmail("newuser@example.com")).toMatchObject({ plan: "free" });
  });

  it("AC3: invalid iss → /auth/error?code=invalid_issuer", async () => {
    mockGoogleProvider({ email: "x@y.z", iss: "https://evil.com", aud: process.env.GOOGLE_CLIENT_ID! });
    const res = await request("/api/auth/callback/google").post({ code: "fake", state: "csrf" });
    expect(res.headers.location).toMatch(/\/auth\/error\?code=invalid_issuer/);
  });

  it("AC6: open-redirect attempt blocked", async () => {
    const res = await request("/api/auth/callback/google?callbackUrl=https://evil.com").post({ code: "fake", state: "csrf" });
    expect(res.headers.location).toBe("/dashboard");
  });

  it("AC7: 10 req/min/IP rate limit", async () => {
    for (let i = 0; i < 10; i++) await request("/api/auth/callback/google").post({ code: "x", state: "y" });
    const res11 = await request("/api/auth/callback/google").post({ code: "x", state: "y" });
    expect(res11.status).toBe(429);
    expect(res11.headers["retry-after"]).toBeDefined();
  });
});
```

Plus a `package-lock`-style assertion in CI:

```bash
# .github/workflows/ci.yml — fragment
- name: Pin next-auth to exact v5.0.0-beta.25
  run: |
    if ! grep -q '"next-auth": "5.0.0-beta.25"' apps/web/package.json; then
      echo "next-auth pin violated"; exit 1;
    fi
```

---

## §6 — Implementation skeleton

```ts
// apps/web/src/server/users/upsert-on-signin.ts
import { mongo } from "@/server/db/mongo";
import { traceId as newTrace } from "@/server/obs/trace";
import { sentry } from "@/server/obs/sentry";

type GoogleProfile = { sub: string; email: string; email_verified?: boolean; name?: string };
type Result = { ok: true; userId: string } | { ok: false; traceId: string };

export async function upsertUserOnSignIn(profile: GoogleProfile): Promise<Result> {
  const trace = newTrace();
  try {
    if (!profile.email || !profile.email_verified) return { ok: false, traceId: trace };
    const col = mongo.db("salenoti").collection("users");
    const now = new Date();
    const doc = await col.findOneAndUpdate(
      { email: profile.email.toLowerCase() },
      {
        $setOnInsert: {
          email: profile.email.toLowerCase(),
          plan: "free",
          notificationChannels: { email: true, webPush: false, telegram: false },
          passwordHash: null,
          createdAt: now,
        },
        $set: { updatedAt: now },
        $addToSet: { oauthProviders: { provider: "google", providerAccountId: profile.sub } },
      },
      { upsert: true, returnDocument: "after" }
    );
    if (!doc) return { ok: false, traceId: trace };
    return { ok: true, userId: String(doc._id) };
  } catch (e) {
    sentry.captureException(e, { tags: { trace, fr: "FR-AUTH-001" } });
    return { ok: false, traceId: trace };
  }
}
```

`apps/web/src/middleware.ts`:

```ts
import { auth } from "@/auth";
export default auth((req) => {
  if (!req.auth && req.nextUrl.pathname.startsWith("/dashboard")) {
    return Response.redirect(new URL("/auth/sign-in", req.url));
  }
});
export const config = { matcher: ["/dashboard/:path*"] };
```

---

## §7 — Dependencies

- **External:** Google Cloud Console project with OAuth consent screen approved for `openid email profile` scopes. Doppler workspace with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` (≥ 32 chars) set per env.
- **Internal:** MongoDB Atlas M0 (P0) → M10 (P2) connected via `MONGODB_URI`. Sentry & PostHog initialised (FR-OBS-001 sets these up; if FR-OBS-001 hasn't shipped yet, this FR is allowed to noop the breadcrumb calls behind a `process.env.SENTRY_DSN` guard).
- **Vendor:** `next-auth@5.0.0-beta.25`, `mongodb@6.x`, `zod@3.x`.

---

## §8 — Example payloads

### Successful round-trip (302 to `/dashboard`)

```http
HTTP/1.1 302 Found
Location: /dashboard
Set-Cookie: authjs.session-token=eyJ...; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900
```

### Failure — `USER_UPSERT_FAILED`

```http
HTTP/1.1 302 Found
Location: /auth/error?code=USER_UPSERT_FAILED&trace=01J9Z8K2Q...
```

### Failure — invalid issuer

```http
HTTP/1.1 302 Found
Location: /auth/error?code=invalid_issuer
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Custom MongoDB adapter or Auth.js's built-in?** Resolved → custom upsert in `upsertUserOnSignIn`. Reason: we control the exact write shape (`$addToSet` for `oauthProviders`, `$setOnInsert` for plan/createdAt). The built-in `@auth/mongodb-adapter` writes to a `accounts`/`sessions`/`users` triplet which doubles our index footprint with no benefit at MVP scale.
- **Q2: Edge runtime or Node?** Resolved → Node. `mongodb` driver is not Edge-compatible; Atlas Data API is rejected for cost (every read is metered).
- **Q3: Session strategy `jwt` or `database`?** Resolved → `jwt` (15-min access, refresh handled in FR-AUTH-003). `database` strategy creates a `sessions` collection write per request — at 10K MAU + 50 req/user/day that's 500K writes/day, blows the M10 IOPS budget.
- **Q4: Should `signIn` callback await the upsert, or background it?** Resolved → await. Fail-closed is the rule (plan §B3 PDPL traceability). A half-authenticated session is a security smell.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Google OAuth consent revoked by user | Google returns `error=access_denied` | Sign-in cancelled; user lands on `/auth/sign-in?error=access_denied` | User re-authorises |
| `iss` claim wrong | `signIn` callback returns false | 302 to `/auth/error?code=invalid_issuer` | None — log + alert in OBS |
| `aud` claim wrong | `signIn` callback returns false | 302 to `/auth/error?code=invalid_audience` | Possible env misconfig — rotate `GOOGLE_CLIENT_ID` check |
| MongoDB Atlas unreachable | upsert throws after 3 retries | 302 to `/auth/error?code=USER_UPSERT_FAILED` | Atlas status check; if multi-region, failover |
| Doppler secret rotation mid-flight | Two callbacks get different `GOOGLE_CLIENT_SECRET` | Half fail with `invalid_grant` from Google | Auth.js retries on next attempt with new env |
| Replay attack — old auth code | Google returns `invalid_grant` | 302 to `/auth/error?code=invalid_grant` | None — single-use auth codes by design |
| Rate-limit triggered (credential stuffing) | `@nestjs/throttler` returns 429 | `Retry-After: 60` | Backoff |
| Race: two parallel first-time sign-ins for same email | Mongo unique-index conflict | One succeeds, other returns `users` from second findOneAndUpdate | Both end up at `/dashboard` correctly (idempotent) |
| Sentry/PostHog down | breadcrumb noop | Sign-in still succeeds | OBS pillar self-heals; no user impact |
| Clock skew > 60 s vs Google | JWT `iat`/`exp` rejected | 302 to `/auth/error?code=clock_skew` | NTP sync the host |

---

## §11 — Notes

- Auth.js v5 stable release ETA is still unclear; we re-evaluate the pin every quarter or on stable v5.0.0 release. Pin upgrade is itself a follow-up FR (`FR-AUTH-001a-pin-upgrade-vN`).
- Magic-link email auth (FR-AUTH-002) and JWT refresh rotation (FR-AUTH-003) are the rest of slice 1. This FR is the foundation for both.
- We deliberately do not implement Zalo OAuth in P0 — Zalo developer registration requires Vietnamese business entity verification which is the long-pole on FR-LEGAL-001. Once LEGAL-001 lands, Zalo becomes a P2 candidate.

---

*End of FR-AUTH-001. Status: shipped (2026-05-17).*
