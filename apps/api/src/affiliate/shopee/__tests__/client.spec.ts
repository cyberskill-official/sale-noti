import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopeeAffiliateClient } from "../client";
import { ShopeeApiError } from "../errors";

const health = vi.hoisted(() => ({
  outcomes: [] as string[],
}));

vi.mock("../../../scheduler/shopee-api-health", () => ({
  recordApiOutcome: vi.fn(async (outcome: string) => {
    health.outcomes.push(outcome);
  }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function productOfferBody(productName = "Áo thun nam basic") {
  return {
    data: {
      productOfferV2: {
        nodes: [
          {
            itemId: "9876543210",
            shopId: "123456",
            productName,
            priceMin: 89_000,
            priceMax: 129_000,
            productLink: "https://shopee.vn/product-i.123456.9876543210",
            commissionRate: 0.03,
            sales: 1247,
            imageUrl: "https://cf.shopee.vn/file/example",
          },
        ],
      },
    },
  };
}

function makeClient() {
  const cfg = {
    get: vi.fn((key: string) => {
      if (key === "SHOPEE_AFFILIATE_APP_ID") return "appid123";
      if (key === "SHOPEE_AFFILIATE_APP_SECRET") return "secret456";
      return undefined;
    }),
    getOrThrow: vi.fn((key: string) => {
      if (key === "SHOPEE_AFFILIATE_APP_ID") return "appid123";
      if (key === "SHOPEE_AFFILIATE_APP_SECRET") return "secret456";
      throw new Error(`missing ${key}`);
    }),
  };
  const rateLimit = { acquire: vi.fn(async () => undefined) };
  const sentry = {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  };
  const posthog = { capture: vi.fn() };
  const client = new ShopeeAffiliateClient(cfg as any, rateLimit as any, sentry, posthog);
  (client as any).sleep = vi.fn(async () => undefined);
  return { client, cfg, rateLimit, sentry, posthog };
}

describe("FR-AFF-001 — Shopee Affiliate client", () => {
  beforeEach(() => {
    health.outcomes = [];
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses GraphQL POST with signed Authorization header and parses productOfferV2", async () => {
    const { client, rateLimit, posthog, sentry } = makeClient();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, productOfferBody()));

    const result = await client.productOfferV2({ itemId: 9876543210, shopId: 123456 });

    expect(result?.productName).toBe("Áo thun nam basic");
    expect(rateLimit.acquire).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://open-api.affiliate.shopee.vn/graphql");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: expect.stringMatching(/^SHA256 Credential=appid123, Signature=[a-f0-9]{64}, Timestamp=\d+$/),
    });
    expect(health.outcomes).toEqual(["success"]);
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ category: "shopee.api.success" }));
    expect(posthog.capture).toHaveBeenCalledWith(
      "shopee_api_call",
      expect.objectContaining({ method: "productOfferV2", status: "success" }),
    );
  });

  it("retries 429/5xx responses up to 3 times with exponential jitter backoff", async () => {
    const { client, rateLimit } = makeClient();
    const sleep = vi.mocked((client as any).sleep);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { errors: [{ extensions: { code: "INTERNAL_SERVER_ERROR" } }] }))
      .mockResolvedValueOnce(jsonResponse(429, { errors: [{ extensions: { code: "RATE_LIMIT" } }] }))
      .mockResolvedValueOnce(jsonResponse(200, productOfferBody("Retry success")));

    const result = await client.productOfferV2({ itemId: 1, shopId: 2 });

    expect(result?.productName).toBe("Retry success");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rateLimit.acquire).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(22_500);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(37_500);
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(45_000);
    expect(sleep.mock.calls[1][0]).toBeLessThanOrEqual(75_000);
    expect(health.outcomes).toEqual(["error_5xx", "error_429", "success"]);
  });

  it("opens the circuit after 5 failed logical calls and blocks the next call before fetch", async () => {
    const { client } = makeClient();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(429, { errors: [{ extensions: { code: "RATE_LIMIT" } }] }));

    for (let i = 0; i < 5; i++) {
      await expect(client.productOfferV2({ itemId: i + 1, shopId: 1 })).rejects.toMatchObject({ code: "rate_limit" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);

    await expect(client.productOfferV2({ itemId: 10, shopId: 1 })).rejects.toMatchObject({
      code: "service_unavailable",
      message: "circuit_breaker_open",
    });
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("maps GraphQL errors without exposing raw payloads to analytics", async () => {
    const { client, posthog } = makeClient();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200, productOfferBody("Sensitive product title")));

    await client.productOfferV2({ itemId: 1, shopId: 1 });

    const analytics = JSON.stringify(posthog.capture.mock.calls);
    expect(analytics).not.toContain("Sensitive product title");
    expect(analytics).not.toContain("productOfferV2(itemId");
    expect(analytics).toContain("productOfferV2");
  });

  it("re-signs once after timestamp drift and maps timeout to service_unavailable", async () => {
    const { client } = makeClient();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { errors: [{ extensions: { code: "INVALID_TIMESTAMP" } }] }))
      .mockResolvedValueOnce(jsonResponse(200, productOfferBody("Clock fixed")));

    await expect(client.productOfferV2({ itemId: 1, shopId: 1 })).resolves.toMatchObject({
      productName: "Clock fixed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const { client: timeoutClient, sentry } = makeClient();
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(timeoutClient.productOfferV2({ itemId: 1, shopId: 1 })).rejects.toMatchObject({
      code: "service_unavailable",
      message: "timeout",
    });
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "Shopee API timeout",
      expect.objectContaining({ tags: expect.objectContaining({ fr: "FR-AFF-001", method: "productOfferV2" }) }),
    );
  });
});
