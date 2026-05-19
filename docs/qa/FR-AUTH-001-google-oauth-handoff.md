# FR-AUTH-001 Google OAuth External Handoff

**Status:** `BLOCKED: EXTERNAL DEPENDENCY` for real Google consent round-trip and p95 timing.  
**Local state:** implementation and deterministic tests pass with mock/sandbox credentials.  
**Do not auto-publish credentials:** store the values in Doppler or the deployment secret manager only.

## Google Cloud Console OAuth Client

Create an OAuth 2.0 Client ID:

- Application type: `Web application`
- Name: `SaleNoti Web`
- Authorized JavaScript origins:
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
  - `https://staging.salenoti.vn`
  - `https://salenoti.vn`
- Authorized redirect URIs:
  - `http://localhost:3000/api/auth/callback/google`
  - `http://127.0.0.1:3000/api/auth/callback/google`
  - `https://staging.salenoti.vn/api/auth/callback/google`
  - `https://salenoti.vn/api/auth/callback/google`

OAuth consent screen:

- App name: `SaleNoti`
- User support email: `legal@salenoti.vn`
- Developer contact email: `legal@salenoti.vn`
- Authorized domains: `salenoti.vn`
- Privacy policy URL: `https://salenoti.vn/privacy`
- Scopes: `openid`, `email`, `profile` only

## Secret Payload

Set these per environment:

```bash
doppler secrets set \
  AUTH_SECRET="$(openssl rand -hex 32)" \
  GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="<client-secret>" \
  APP_URL="https://salenoti.vn"
```

For local manual verification:

```bash
doppler run -- pnpm --filter @salenoti/web dev
```

Open `http://localhost:3000/auth/sign-in`, click `Sign in with Google`, complete consent with a test Google account, and confirm the browser lands on `/dashboard` with an Auth.js HTTP-only session cookie.

## Completion Evidence Needed

To move `FR-AUTH-001` from `Blocked` to `Completed`, attach or paste:

- Google OAuth client ID redacted to prefix/suffix only.
- Screenshot or log showing OAuth consent screen configured for only `openid email profile`.
- Live manual test timestamp where sign-in lands on `/dashboard`.
- p95 sample command/result for 20 sign-in callback observations, or the staging APM trace showing `< 800 ms p95`.
