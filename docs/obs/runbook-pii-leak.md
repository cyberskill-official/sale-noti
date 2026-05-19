# PII Leak Runbook

Use this when PII appears in Sentry, PostHog, Better Stack, Slack, or any OBS payload.

1. Contain: disable the emitting feature flag or route, then deploy the redaction fix.
2. Preserve: record event ids, timestamps, deploy sha, affected processor, and suspected data classes.
3. Purge: use vendor purge APIs for Sentry/PostHog/Better Stack where supported; retain purge receipts.
4. Assess: DPO decides whether the event is material under PDPL and whether A05 notification is required.
5. Notify: inform founder, DPO, counsel, and on-call.
6. File: if material, use `docs/legal/A05-breach-notification-template.md` within the 72-hour window.
7. Prevent: add or update a redaction regression test in the relevant app before closing the incident.

Never paste raw leaked values into Slack or issue trackers. Use hashes, vendor event ids, and affected field names.
