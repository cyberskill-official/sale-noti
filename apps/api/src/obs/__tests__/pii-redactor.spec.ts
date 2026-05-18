import { describe, expect, it } from "vitest";
import { redactBreadcrumb, redactObject, redactSentryEvent, redactUrl } from "../pii-redactor";

describe("FR-OBS-001 — API PII redaction", () => {
  it("redacts user, cookies, tags, extras, and contexts before Sentry send", () => {
    const event = redactSentryEvent({
      user: { email: "buyer@example.com", ip_address: "203.0.113.9" },
      request: { cookies: { "authjs.session-token": "raw-session", other: "ok" } },
      tags: { email: "lead@example.com" },
      extra: { ip: "198.51.100.20", phone: "+84901234567" },
      contexts: { auth: { refreshToken: "raw-refresh" } },
    });

    expect(JSON.stringify(event)).not.toContain("buyer@example.com");
    expect(JSON.stringify(event)).not.toContain("raw-session");
    expect(JSON.stringify(event)).not.toContain("198.51.100.20");
    expect(JSON.stringify(event)).not.toContain("+84901234567");
    expect(event.user.email).toBe("[redacted]");
    expect(event.request.cookies["authjs.session-token"]).toBe("[redacted]");
  });

  it("strips sensitive query values and unsafe request bodies from breadcrumbs", () => {
    const breadcrumb = redactBreadcrumb({
      category: "fetch",
      data: {
        method: "PATCH",
        url: "https://api.salenoti.vn/v1/watchlists?token=raw&secret=abc&safe=1",
        body: { email: "user@example.com" },
      },
    });

    expect(breadcrumb.data.url).toContain("token=%5Bredacted%5D");
    expect(breadcrumb.data.url).toContain("secret=%5Bredacted%5D");
    expect(breadcrumb.data.url).toContain("safe=1");
    expect(breadcrumb.data.body).toBeUndefined();
  });

  it("redacts nested analytics payloads and relative URLs", () => {
    const payload = redactObject({ nested: { email: "u@example.com", ip: "203.0.113.10", token: "raw-token" } });

    expect(JSON.stringify(payload)).toContain("[redacted-email]");
    expect(JSON.stringify(payload)).toContain("[redacted-ip]");
    expect(JSON.stringify(payload)).not.toContain("raw-token");
    expect(redactUrl("/health?password=secret&ok=1")).toBe("/health?password=%5Bredacted%5D&ok=1");
    expect(redactUrl("not a url with user@example.com")).toContain("[redacted-email]");
    expect(redactUrl("http://[bad-url-with-user@example.com")).toContain("[redacted-email]");
    expect(redactUrl("http://")).toBe("http://");
  });
});
