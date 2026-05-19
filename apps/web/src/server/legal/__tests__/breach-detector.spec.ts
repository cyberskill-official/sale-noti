import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageDpoForBreach, shouldPageForSignal, type BreachSignal } from "../breach-detector";

const OLD_ENV = { ...process.env };

describe("FR-LEGAL-001 — breach detector", () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...OLD_ENV };
  });

  it("pages security-critical signals and ignores low-volume bounce noise", () => {
    const base: BreachSignal = {
      kind: "mongo_anomaly",
      severity: "medium",
      source: "unit",
      summary: "fixture",
    };

    expect(shouldPageForSignal({ ...base, severity: "critical" })).toBe(true);
    expect(shouldPageForSignal({ ...base, kind: "auth_reuse_detected" })).toBe(true);
    expect(shouldPageForSignal({ ...base, kind: "unauthorized_access" })).toBe(true);
    expect(shouldPageForSignal({ ...base, kind: "manual_operator_trigger" })).toBe(true);
    expect(shouldPageForSignal({ ...base, kind: "resend_bounce_spike", subjectCountEstimate: 99 })).toBe(false);
    expect(shouldPageForSignal({ ...base, kind: "resend_bounce_spike", subjectCountEstimate: 100 })).toBe(true);
    expect(shouldPageForSignal({ ...base, severity: "high" })).toBe(true);
  });

  it("builds a 72-hour A05 deadline and sends Slack/email when configured", async () => {
    process.env.SLACK_FOUNDER_INCIDENTS_WEBHOOK = "https://hooks.slack.test/founder";
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.DPO_EMAIL = "legal@cyberskill.world";

    const detectedAt = new Date("2026-05-18T00:00:00.000Z");
    const page = await pageDpoForBreach({
      kind: "auth_reuse_detected",
      severity: "high",
      source: "sentry",
      detectedAt,
      subjectCountEstimate: 1,
      traceId: "trace-1",
      summary: "Refresh token reuse detected",
    });

    expect(page.incidentId).toBe("INC-20260518-auth_reuse_detected");
    expect(page.deadlineAt.toISOString()).toBe("2026-05-21T00:00:00.000Z");
    expect(page.message).toContain("A05Deadline=2026-05-21T00:00:00.000Z");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((fetch as any).mock.calls)).not.toContain("authjs.refresh-token");
  });

  it("returns the page payload without network calls when providers are unconfigured", async () => {
    delete process.env.SLACK_FOUNDER_INCIDENTS_WEBHOOK;
    delete process.env.SLACK_OBS_WEBHOOK;
    delete process.env.RESEND_API_KEY;

    const page = await pageDpoForBreach({
      kind: "manual_operator_trigger",
      severity: "medium",
      source: "admin",
      summary: "Manual tabletop drill",
    });

    expect(page.message).toContain("Manual tabletop drill");
    expect(fetch).not.toHaveBeenCalled();
  });
});
