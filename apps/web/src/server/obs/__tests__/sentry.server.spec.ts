import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  init: sentryMock.init,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
}));

async function loadSentry() {
  vi.resetModules();
  return import("../sentry.server");
}

beforeEach(() => {
  delete process.env.SENTRY_DSN_WEB;
  delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  delete process.env.GIT_COMMIT;
  sentryMock.init.mockReset();
});

describe("FR-OBS-002 — web Sentry sampler", () => {
  it("does not initialize without a DSN", async () => {
    await loadSentry();

    expect(sentryMock.init).not.toHaveBeenCalled();
  });

  it("uses 100% sampling for B2B traffic and keeps public traffic at the configured rate", async () => {
    process.env.SENTRY_DSN_WEB = "https://public@example.ingest.sentry.io/1";
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.2";

    await loadSentry();

    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.ingest.sentry.io/1",
        tracesSampler: expect.any(Function),
        profilesSampleRate: 0.05,
      }),
    );

    const config = sentryMock.init.mock.calls[0]?.[0] as {
      tracesSampler: (samplingContext: any) => number;
      beforeSend: (event: any) => any;
      beforeBreadcrumb: (breadcrumb: any) => any;
    };

    expect(
      config.tracesSampler({
        request: {
          url: "https://sale.cyber.skill/dashboard",
          headers: new Headers({ "x-observability-scope": "b2b" }),
        },
      }),
    ).toBe(1);

    expect(
      config.tracesSampler({
        request: {
          url: "https://sale.cyber.skill/auth/sign-in",
          headers: new Headers(),
        },
      }),
    ).toBe(0.2);

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
});
