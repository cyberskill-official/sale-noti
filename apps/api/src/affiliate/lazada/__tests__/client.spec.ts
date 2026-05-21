import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConfigService } from "@nestjs/config";
import { LazadaAffiliateClient } from "../client";
import { LazadaRateLimitGuard } from "../rate-limit-guard";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as Response;
}

function createClient(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    LAZADA_AFFILIATE_BASE_URL: "https://example.test/lazada",
    LAZADA_AFFILIATE_APP_KEY: "app-key",
    LAZADA_AFFILIATE_APP_SECRET: "app-secret",
    LAZADA_REQUEST_TIMEOUT_MS: "1000",
    ...overrides,
  };

  const cfg = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`Missing config: ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;

  const rateLimit = { acquire: vi.fn().mockResolvedValue(undefined) } as unknown as LazadaRateLimitGuard;
  const sentry = {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
  };
  const posthog = {
    capture: vi.fn(),
  };

  return {
    client: new LazadaAffiliateClient(cfg, rateLimit, sentry, posthog),
    rateLimit,
    sentry,
    posthog,
  };
}

describe("FR-AFF-005 — LazadaAffiliateClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("returns a normalized offer and emits telemetry", async () => {
    const { client, rateLimit, posthog, sentry } = createClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          item: {
            title: "Ao thun basic",
            price: "89000",
            originalPrice: "129000",
            imageUrl: "https://img.example/lazada.jpg",
            affiliateLink: "https://lazada.vn/aff/abc",
            commissionRate: "7.5",
            flashSale: true,
            available: true,
          },
        },
      }),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.productOffer({ shopId: 123, itemId: 456 });

    expect(result).toMatchObject({
      platform: "lazada",
      platformProductId: "lazada:123-456",
      shopId: 123,
      itemId: 456,
      productName: "Ao thun basic",
      currentPrice: 89_000,
      originalPrice: 129_000,
      discountPct: 31,
      imageUrl: "https://img.example/lazada.jpg",
      affiliateLink: "https://lazada.vn/aff/abc",
      commissionRate: 7.5,
      currency: "VND",
      flashSale: true,
    });
    expect(rateLimit.acquire).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/lazada");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: expect.stringMatching(/^LZSHA256 Credential=app-key, Signature=[a-f0-9]{64}, Timestamp=\d+$/),
    });
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_api_call",
      expect.objectContaining({
        platform: "lazada",
        operation: "productOffer",
        status: "success",
        outcome: "live",
      }),
    );
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "affiliate.lazada",
        data: expect.objectContaining({ platform: "lazada", outcome: "live" }),
      }),
    );
  });

  it("returns null for unavailable items without leaking raw payloads", async () => {
    const { client, posthog } = createClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          item: {
            title: "Hidden item",
            price: 100_000,
            affiliateLink: "https://lazada.vn/aff/hidden",
            available: false,
          },
        },
      }),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.productOffer({ shopId: 1, itemId: 2 })).resolves.toBeNull();

    const analytics = JSON.stringify(posthog.capture.mock.calls);
    expect(analytics).not.toContain("Hidden item");
    expect(analytics).not.toContain("affiliateLink");
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_api_call",
      expect.objectContaining({
        platform: "lazada",
        operation: "productOffer",
        outcome: "dead",
      }),
    );
  });

  it("fails fast on missing credentials before fetch", async () => {
    const { client, rateLimit } = createClient({ LAZADA_AFFILIATE_APP_SECRET: "" });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.productOffer({ shopId: 1, itemId: 2 })).rejects.toMatchObject({ code: "config_error" });
    expect(rateLimit.acquire).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the breaker after repeated 429s", async () => {
    const { client } = createClient();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { error: "rate limited" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) {
      await expect(client.productOffer({ shopId: 1, itemId: i + 1 })).rejects.toMatchObject({ code: "rate_limit" });
    }

    await expect(client.productOffer({ shopId: 1, itemId: 99 })).rejects.toMatchObject({
      code: "service_unavailable",
      message: "circuit_breaker_open",
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
