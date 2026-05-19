import { describe, expect, it } from "vitest";
import { redactBreadcrumb, redactObject, redactSentryEvent, redactUrl } from "@/server/obs/pii-redactor";

describe("FR-OBS-001 — PII redaction", () => {
  it("redacts Sentry user, cookies, tags, extra, and contexts before send", () => {
    const event = redactSentryEvent({
      user: { email: "user@example.com", ip_address: "203.0.113.9" },
      request: { cookies: { "authjs.refresh-token": "secret-refresh", other: "ok" } },
      tags: { email: "buyer@example.com" },
      extra: { ip: "198.51.100.1", phone: "+84901234567" },
      contexts: { nested: { token: "raw-token" } },
    });

    expect(JSON.stringify(event)).not.toContain("user@example.com");
    expect(JSON.stringify(event)).not.toContain("secret-refresh");
    expect(JSON.stringify(event)).not.toContain("198.51.100.1");
    expect(JSON.stringify(event)).not.toContain("+84901234567");
    expect(event.user.email).toBe("[redacted]");
    expect(event.request.cookies["authjs.refresh-token"]).toBe("[redacted]");
  });

  it("strips sensitive query values and request bodies from breadcrumbs", () => {
    const breadcrumb = redactBreadcrumb({
      category: "fetch",
      data: {
        method: "POST",
        url: "https://salenoti.vn/api/auth/magic-link/consume?token=raw&code=abc&safe=1",
        body: { email: "user@example.com" },
      },
    });

    expect(breadcrumb.data.url).toContain("token=%5Bredacted%5D");
    expect(breadcrumb.data.url).toContain("code=%5Bredacted%5D");
    expect(breadcrumb.data.url).toContain("safe=1");
    expect(breadcrumb.data.body).toBeUndefined();
  });

  it("redacts nested PostHog/Sentry property payloads", () => {
    const payload = redactObject({ email: "u@example.com", nested: { ip: "203.0.113.10" } });
    expect(JSON.stringify(payload)).toContain("[redacted-email]");
    expect(JSON.stringify(payload)).toContain("[redacted-ip]");
  });

  it("preserves relative URL paths while scrubbing sensitive keys", () => {
    expect(redactUrl("/api/x?password=secret&t=abc&ok=1")).toBe("/api/x?password=%5Bredacted%5D&t=%5Bredacted%5D&ok=1");
    expect(redactUrl("not a url with user@example.com and +84901234567")).toBe(
      "not a url with [redacted-email] and [redacted-phone]",
    );
    expect(redactUrl("http://")).toBe("http://");
  });
});
