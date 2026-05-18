# PostHog Event Taxonomy

All authenticated `distinctId` values must be `sha256(userEmail.toLowerCase() + POSTHOG_PII_SALT).slice(0, 16)` or a non-PII internal user id. Raw emails, phone numbers, IP addresses, raw tokens, and secrets are forbidden.

| Event | Required properties | Notes |
|---|---|---|
| `auth_sign_in` | `method`, `source` | `method` is `google` or `magic_link` |
| `auth_session_created` | `method` | Emitted on initial refresh family creation |
| `auth_session_refreshed` | `family_age_days` | No raw token |
| `auth_session_revoked` | `reason` | `user_signout` or security reason |
| `product_tracked` | `shopId`, `itemId`, `productId`, `source`, `hasNickname`, `triggerCount` | Product identifiers only |
| `alert_sent` | `channel`, `trigger`, `latency_ms` | No email body |
| `alert_clicked` | `channel`, `trigger`, `ttc_seconds` | No raw URL token |
| `affiliate_link_clicked` | `source`, `productId`, `position` | No commission-based ranking fields |
| `commission_confirmed` | `amount_vnd_bucket`, `network` | Bucketed value only |
| `extension_installed` | `version` | Anonymous unless linked |
| `pre_click_interstitial_continued` | `destination_host` | Host only |
| `subscription_started` | `plan`, `gateway`, `interval`, `amountVnd` | No gateway customer email |
| `subscription_cancelled` | `reason`, `tenure_days` | No free-text PII |
| `dsr_requested` | `kind` | `export`, `delete`, or `access` |
| `breach_signal` | `kind` | Context is redacted before capture |
