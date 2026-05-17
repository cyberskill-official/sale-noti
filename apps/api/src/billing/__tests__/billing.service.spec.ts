import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingService } from "../billing.service";

const userId = "665000000000000000000001";
const state = vi.hoisted(() => ({
  usersFindOne: vi.fn(),
  subscriptionsFindOne: vi.fn(),
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "users") return { findOne: state.usersFindOne };
        if (name === "subscriptions") return { findOne: state.subscriptionsFindOne };
        throw new Error(`unexpected collection ${name}`);
      },
    }),
  },
}));

vi.mock("../../queue/redis.client", () => ({
  redis: { set: vi.fn(async () => "OK") },
}));

describe("FR-BILL-001 — billing subscribe", () => {
  const cfg = {
    get: vi.fn((key: string) => {
      if (key === "APP_URL") return "https://salenoti.vn";
      if (key === "API_URL") return "https://api.salenoti.vn";
      return process.env[key];
    }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    state.usersFindOne.mockResolvedValue({ _id: userId, email: "buyer@example.com" });
    state.subscriptionsFindOne.mockResolvedValue(null);
  });

  it("returns a deterministic dev checkout URL when Stripe credentials are absent", async () => {
    const service = new BillingService(cfg, { capture: vi.fn() }, { captureException: vi.fn() });

    await expect(
      service.subscribe({ userId, plan: "pro", interval: "monthly", paymentMethod: "stripe" })
    ).resolves.toEqual({
      provider: "stripe",
      redirectUrl: "https://salenoti.vn/billing/upgrade?dev_stub=stripe&plan=pro",
    });
  });

  it("creates Stripe checkout using metadata-driven webhook lifecycle", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.test/session" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new BillingService(cfg, { capture: vi.fn() }, { captureException: vi.fn() });

    const result = await service.subscribe({ userId, plan: "pro_plus", interval: "yearly", paymentMethod: "stripe" });

    expect(result.redirectUrl).toBe("https://checkout.stripe.test/session");
    const requestInit = (fetchMock.mock.calls[0] as any[])[1];
    const body = String(requestInit.body);
    expect(body).toContain("metadata%5BuserId%5D=665000000000000000000001");
    expect(body).toContain("metadata%5Bplan%5D=pro_plus");
    expect(body).toContain("recurring%5D%5Binterval%5D=year");
  });
});
