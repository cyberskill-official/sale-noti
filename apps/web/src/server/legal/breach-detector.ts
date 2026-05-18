// FR-LEGAL-001 §1 #7 — breach detector signal normalization and paging.
// Provider-specific webhooks call this helper after validating their own signature.
export type BreachSignalKind =
  | "mongo_anomaly"
  | "auth_reuse_detected"
  | "unauthorized_access"
  | "resend_bounce_spike"
  | "stripe_fraud_warning"
  | "manual_operator_trigger";

export type BreachSignal = {
  kind: BreachSignalKind;
  severity: "medium" | "high" | "critical";
  source: string;
  detectedAt?: Date;
  subjectCountEstimate?: number;
  summary: string;
  traceId?: string;
};

export type BreachPage = {
  incidentId: string;
  deadlineAt: Date;
  message: string;
};

const A05_WINDOW_MS = 72 * 60 * 60 * 1000;

export async function pageDpoForBreach(signal: BreachSignal): Promise<BreachPage> {
  const detectedAt = signal.detectedAt ?? new Date();
  const deadlineAt = new Date(detectedAt.getTime() + A05_WINDOW_MS);
  const incidentId = `INC-${detectedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${signal.kind}`;
  const message = [
    `[${signal.severity.toUpperCase()}] SaleNoti personal-data breach signal`,
    `incident=${incidentId}`,
    `kind=${signal.kind}`,
    `source=${signal.source}`,
    `detectedAt=${detectedAt.toISOString()}`,
    `A05Deadline=${deadlineAt.toISOString()}`,
    `subjects=${signal.subjectCountEstimate ?? "unknown"}`,
    `trace=${signal.traceId ?? "n/a"}`,
    signal.summary,
  ].join("\n");

  await Promise.allSettled([sendSlack(message), sendEmail(message)]);
  return { incidentId, deadlineAt, message };
}

export function shouldPageForSignal(signal: BreachSignal): boolean {
  if (signal.severity === "critical") return true;
  if (signal.kind === "auth_reuse_detected" || signal.kind === "unauthorized_access") return true;
  if (signal.kind === "resend_bounce_spike" && (signal.subjectCountEstimate ?? 0) >= 100) return true;
  if (signal.kind === "manual_operator_trigger") return true;
  return signal.severity === "high";
}

async function sendSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_FOUNDER_INCIDENTS_WEBHOOK ?? process.env.SLACK_OBS_WEBHOOK;
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function sendEmail(text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.DPO_EMAIL ?? "legal@salenoti.vn";
  if (!key) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.SECURITY_FROM_EMAIL ?? "security@salenoti.vn",
      to,
      subject: "SaleNoti breach signal: 72h A05 clock started",
      text,
    }),
  });
}
