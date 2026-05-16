// FR-OBS-001 §1 #8 + FR-LEGAL-001 §6 — Slack webhook poster.
type SlackChannel = "oncall" | "metrics" | "incidents" | "b2b";

const ENV_KEY: Record<SlackChannel, string> = {
  oncall: "SLACK_OBS_WEBHOOK",
  metrics: "SLACK_METRICS_WEBHOOK",
  incidents: "SLACK_INCIDENTS_WEBHOOK",
  b2b: "SLACK_B2B_WEBHOOK",
};

export const slack = {
  async post(channel: SlackChannel, message: { text: string; blocks?: unknown[] }) {
    const url = process.env[ENV_KEY[channel]];
    if (!url) {
      console.debug(`[slack:dev-stub:${channel}]`, message.text);
      return;
    }
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
    } catch (e) {
      console.error(`[slack:${channel}] post failed`, e);
    }
  },
};
