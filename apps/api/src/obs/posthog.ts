// FR-OBS-001 §3 — PostHog wrapper with PII hashing.
import crypto from "node:crypto";
import { PostHog } from "posthog-node";

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
    const c = client();
    if (!c) {
      console.debug("[posthog:dev-stub]", event, props);
      return;
    }
    const { userEmail, ...rest } = props;
    c.capture({
      distinctId: userEmail ? distinctId(userEmail) : "anon",
      event,
      properties: rest,
    });
  },
  async shutdown() {
    if (_ph) await _ph.shutdown();
  },
};
