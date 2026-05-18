# FR-OBS-001 Provider Handoff

**Status:** `BLOCKED: EXTERNAL DEPENDENCY` for live vendor dashboards.  
**Local code/tests:** passing with no-op-safe SDK wrappers and redaction tests.

## Required Secrets

```bash
doppler secrets set \
  SENTRY_DSN_WEB="<salenoti-web-dsn>" \
  NEXT_PUBLIC_SENTRY_DSN_WEB="<salenoti-web-browser-dsn>" \
  SENTRY_DSN_API="<salenoti-api-dsn>" \
  SENTRY_TRACES_SAMPLE_RATE="0.1" \
  POSTHOG_KEY="<posthog-project-key>" \
  POSTHOG_HOST="https://us.i.posthog.com" \
  POSTHOG_PII_SALT="$(openssl rand -hex 32)" \
  BETTER_STACK_TOKEN="<better-stack-token>" \
  SLACK_OBS_WEBHOOK="<slack-oncall-webhook>"
```

## Sentry Setup

- Create `salenoti-web` and `salenoti-api` projects.
- Configure Slack alerts:
  - P1 unhandled exception: immediate.
  - P1 security event: `kind in {reuse_detected, auth_breach, breach_signal}`.
  - P2 spike: > 50 same fingerprint in one hour.
- Retention: 30 days.
- Confirm redaction by sending a test event containing `authjs.refresh-token`, email, IP, and VN phone; dashboard must show redacted values only.

## PostHog Setup

- Create the SaleNoti project on US cloud.
- Apply `infra/posthog-flags.tf`.
- Import taxonomy from `docs/obs/posthog-event-taxonomy.md`.
- Confirm a test `auth_session_refreshed` event uses a non-email `distinctId` and redacted properties.

## Better Stack Setup

Create monitors from `docs/obs/better-stack-monitors.md`.

Required alerts:

- Slack `#oncall`
- Founder email
- 3 consecutive failures

## Completion Evidence Needed

Attach:

- Sentry project URLs and redacted test-event screenshot.
- PostHog project URL and redacted event screenshot.
- Better Stack monitor list screenshot.
- Slack test alert screenshot.
