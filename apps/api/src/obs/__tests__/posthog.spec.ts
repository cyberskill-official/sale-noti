import { beforeEach, describe, expect, it, vi } from "vitest";

const posthogMock = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(),
  instances: [] as Array<{ key: string; options: unknown; capture: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> }>,
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = posthogMock.capture;
    shutdown = posthogMock.shutdown;

    constructor(key: string, options: unknown) {
      posthogMock.instances.push({ key, options, capture: this.capture, shutdown: this.shutdown });
    }
  },
}));

async function loadPosthog() {
  vi.resetModules();
  return import("../posthog");
}

beforeEach(() => {
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  process.env.POSTHOG_PII_SALT = "posthog-salt";
  posthogMock.capture.mockReset();
  posthogMock.shutdown.mockReset();
  posthogMock.instances.length = 0;
});

describe("FR-OBS-001 — API PostHog wrapper", () => {
  it("no-ops to the dev stub without a provider key and redacts payloads before logging", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { posthog } = await loadPosthog();

    posthog.capture("api_event", {
      userEmail: "buyer@example.com",
      email: "buyer@example.com",
      ip: "203.0.113.50",
      authToken: "secret-token",
    });

    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(JSON.stringify(debug.mock.calls)).not.toContain("buyer@example.com");
    expect(JSON.stringify(debug.mock.calls)).not.toContain("203.0.113.50");
    expect(JSON.stringify(debug.mock.calls)).not.toContain("secret-token");
    debug.mockRestore();
  });

  it("hashes email distinct ids, honors opt-out, and sends redacted provider payloads", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const { posthog } = await loadPosthog();

    posthog.capture("api_event", {
      userEmail: "Buyer@Example.com",
      ip: "203.0.113.51",
      phone: "+84901234567",
      nested: { password: "raw-password" },
    });
    posthog.capture("api_event", { analytics_opt_out: true, userEmail: "optout@example.com" });

    expect(posthogMock.instances).toHaveLength(1);
    expect(posthogMock.instances[0]?.options).toMatchObject({ host: "https://us.i.posthog.com" });
    expect(posthogMock.capture).toHaveBeenCalledTimes(1);
    expect(posthogMock.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: expect.stringMatching(/^[0-9a-f]{16}$/),
        event: "api_event",
        properties: expect.objectContaining({
          ip: "[redacted-ip]",
          phone: "[redacted-phone]",
          nested: { password: "[redacted]" },
        }),
      }),
    );
    expect(JSON.stringify(posthogMock.capture.mock.calls)).not.toContain("Buyer@Example.com");
    expect(JSON.stringify(posthogMock.capture.mock.calls)).not.toContain("raw-password");
  });

  it("uses the configured PostHog host and shuts down the provider client", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    process.env.POSTHOG_HOST = "https://eu.posthog.example";
    const { posthog } = await loadPosthog();

    posthog.capture("api_event", {});
    posthog.capture("api_event_2", {});
    await posthog.shutdown();

    expect(posthogMock.instances).toHaveLength(1);
    expect(posthogMock.instances[0]?.options).toMatchObject({ host: "https://eu.posthog.example" });
    expect(posthogMock.shutdown).toHaveBeenCalledOnce();
  });
});
