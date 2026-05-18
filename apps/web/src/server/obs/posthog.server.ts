// FR-OBS-001/FR-AUTH-003 — server-side PostHog wrapper. No-ops without POSTHOG_KEY.
import crypto from "crypto";
import { PostHog } from "posthog-node";
import { redactObject } from "./pii-redactor";

let client: PostHog | null | undefined;

function posthog(): PostHog | null {
  if (client !== undefined) return client;
  if (!process.env.POSTHOG_KEY) return (client = null);
  client = new PostHog(process.env.POSTHOG_KEY, {
    host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
  });
  return client;
}

export const posthogServer = {
  capture(event: string, distinctId: string, properties: Record<string, unknown> = {}) {
    if (properties.analytics_opt_out === true) return;
    const safeDistinctId = distinctId.includes("@")
      ? crypto
          .createHash("sha256")
          .update(`${distinctId.toLowerCase()}${process.env.POSTHOG_PII_SALT ?? ""}`)
          .digest("hex")
          .slice(0, 16)
      : distinctId;
    const safeProperties = redactObject({ ...properties });
    posthog()?.capture({ event, distinctId: safeDistinctId, properties: safeProperties });
  },
};
