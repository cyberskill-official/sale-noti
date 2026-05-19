// FR-OBS-001 §3 — PostHog wrapper with PII hashing.
import crypto from "node:crypto";
import { PostHog } from "posthog-node";
import { redactObject } from "./pii-redactor";

let _ph: PostHog | null = null;
function client(): PostHog | null {
  if (_ph) return _ph;
  if (!process.env.POSTHOG_KEY) return null;
  _ph = new PostHog(process.env.POSTHOG_KEY, { host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com" });
  return _ph;
}

function distinctId(email: string) {
  const salt = process.env.POSTHOG_PII_SALT ?? "";
  return crypto.createHash("sha256").update(email + salt).digest("hex").slice(0, 16);
}

export const posthog = {
  capture(event: string, props: Record<string, any> & { userEmail?: string } = {}) {
    if (props.analytics_opt_out === true) return;
    const c = client();
    const { userEmail, ...rest } = props;
    const safeDistinctId = userEmail ? distinctId(userEmail.toLowerCase()) : "anon";
    const safeProps = redactObject({ ...rest });
    if (!c) {
      console.debug("[posthog:dev-stub]", event, { distinctId: safeDistinctId, properties: safeProps });
      return;
    }
    c.capture({
      distinctId: safeDistinctId,
      event,
      properties: safeProps,
    });
  },
  async shutdown() {
    if (_ph) await _ph.shutdown();
  },
};
