# SaleNoti Breach Response Runbook

**Owner:** DPO · **Regulatory clock:** A05 notification within 72 hours of detection.

---

## T+0 To T+1 Hour

1. Confirm the breach signal and assign an incident id `INC-YYYYMMDD-<kind>`.
2. Open a private incident channel and pin the A05 deadline timestamp.
3. Freeze risky jobs if data exfiltration or mass mutation is suspected.
4. Preserve logs: Sentry event IDs, MongoDB Atlas activity feed, API logs, queue job IDs, provider webhook payload IDs.
5. Rotate exposed credentials if any secret is suspected compromised.
6. Start a copy of `A05-breach-notification-template.md` at `docs/legal/incidents/INC-<id>-A05-notification.md`.

## T+1 To T+24 Hours

1. Classify breach type: unauthorized access, accidental disclosure, alteration, loss, denial of access, or sub-processor breach.
2. Estimate affected subjects and data categories.
3. Determine if user notification is required due to high risk.
4. Prepare containment summary and mitigation already completed.
5. Engage outside counsel if the breach involves restricted/confidential data, payment metadata, or more than 100 subjects.
6. Draft user notification copy in Vietnamese and English if required.

## T+24 To T+72 Hours

1. Finalize A05 notification with known facts; do not wait for perfect forensics.
2. Submit to A05 through the documented channel.
3. Record submission timestamp, recipient, and confirmation/receipt.
4. Send user notifications if required.
5. Create post-incident remediation tasks and owners.

## Post-Incident

1. Complete root-cause analysis.
2. Update DPIA, processor register, retention schedule, or technical measures if risk posture changed.
3. Run a tabletop drill within 30 days.
4. Publish transparency note when legally safe and useful for trust.

## Minimum Incident Record

```text
Incident id:
Detected at:
A05 deadline:
Signal kind:
Affected systems:
Affected data categories:
Estimated subjects:
Containment actions:
Notification decision:
A05 submitted at:
User notices sent at:
Follow-up tasks:
```
