import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  init: sentryMock.init,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

async function loadSentry() {
  vi.resetModules();
  return import("../sentry");
}

beforeEach(() => {
  delete process.env.SENTRY_DSN_API;
  delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  delete process.env.GIT_COMMIT;
  sentryMock.init.mockReset();
});

describe("FR-OBS-001 — API Sentry init contract", () => {
  it("does not initialize without a DSN", async () => {
    await loadSentry();

    expect(sentryMock.init).not.toHaveBeenCalled();
  });

  it("initializes with sampling, release, ignored noise, and PII redaction hooks", async () => {
    process.env.SENTRY_DSN_API = "https://public@example.ingest.sentry.io/1";
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.25";
    process.env.GIT_COMMIT = "abc123";

    await loadSentry();

    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.ingest.sentry.io/1",
        tracesSampleRate: 0.25,
        profilesSampleRate: 0.05,
        release: "abc123",
        ignoreErrors: expect.arrayContaining(["AbortError", "NEXT_NOT_FOUND", "ResizeObserver loop limit exceeded"]),
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    );

    const config = sentryMock.init.mock.calls[0]?.[0] as {
      beforeSend: (event: any) => any;
      beforeBreadcrumb: (breadcrumb: any) => any;
    };
    const event = config.beforeSend({
      user: { email: "buyer@example.com" },
      extra: { ip: "203.0.113.60", phone: "+84901234567" },
    });
    const breadcrumb = config.beforeBreadcrumb({
      data: { method: "POST", url: "/x?token=raw", body: { email: "buyer@example.com" } },
    });

    expect(JSON.stringify(event)).not.toContain("buyer@example.com");
    expect(JSON.stringify(event)).not.toContain("203.0.113.60");
    expect(breadcrumb.data.url).toContain("token=%5Bredacted%5D");
    expect(breadcrumb.data.body).toBeUndefined();
  });

  it("uses the default trace sample rate when no override is configured", async () => {
    process.env.SENTRY_DSN_API = "https://public@example.ingest.sentry.io/1";

    await loadSentry();

    expect(sentryMock.init).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0.1 }));
  });
});
