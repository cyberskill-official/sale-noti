import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConfigService } from "@nestjs/config";
import { TikTokShopAffiliateClient } from "../client";
import { TikTokShopRateLimitGuard } from "../rate-limit-guard";

function createResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as Response;
}

function createClient(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    TIKTOK_SHOP_REGION: "VN",
    TIKTOK_SHOP_AFFILIATE_BASE_URL: "https://example.test/tiktok",
    TIKTOK_SHOP_AFFILIATE_APP_KEY: "app-key",
    TIKTOK_SHOP_AFFILIATE_APP_SECRET: "app-secret",
    TIKTOK_SHOP_AFFILIATE_ACCESS_TOKEN: "access-token",
    TIKTOK_SHOP_REQUEST_TIMEOUT_MS: "1000",
    ...overrides,
  };

  const cfg = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`Missing config: ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;

  const rateLimit = {
    acquire: vi.fn().mockResolvedValue(undefined),
  } as unknown as TikTokShopRateLimitGuard;

  const sentry = {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
  };

  const posthog = {
    capture: vi.fn(),
  };

  return {
    client: new TikTokShopAffiliateClient(cfg, rateLimit, sentry, posthog),
    rateLimit,
    sentry,
    posthog,
  };
}

describe("FR-AFF-006 — TikTokShopAffiliateClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("searches open-collaboration products and filters closed results", async () => {
    const { client, rateLimit, posthog, sentry } = createClient();
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse(200, {
        data: {
          products: [
            {
              productId: "987654321",
              title: "Ao khoac mua he",
              price: "199000",
              originalPrice: "299000",
              imageUrl: "https://img.example/tiktokshop.jpg",
              commissionRate: "10",
              openCollaboration: true,
            },
            {
              productId: "222",
              title: "Target only item",
              price: 100000,
              openCollaboration: false,
            },
          ],
        },
      })
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const results = await client.searchOpenCollaborationProducts({ keyword: "ao khoac" });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      platform: "tiktok_shop",
      platformProductId: "tiktok_shop:987654321",
      currentPrice: 199000,
      originalPrice: 299000,
      commissionRate: 10,
      openCollaboration: true,
    });
    expect(rateLimit.acquire).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_api_call",
      expect.objectContaining({
        platform: "tiktok_shop",
        operation: "searchOpenCollaborationProducts",
        status: "success",
        outcome: "live",
      })
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("returns unsupported_market before hitting the network", async () => {
    const { client, rateLimit, posthog } = createClient({ TIKTOK_SHOP_REGION: "UK" });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.searchOpenCollaborationProducts({ keyword: "ao" })).rejects.toMatchObject({ code: "unsupported_market" });
    expect(rateLimit.acquire).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_api_call",
      expect.objectContaining({
        platform: "tiktok_shop",
        operation: "searchOpenCollaborationProducts",
        outcome: "dead",
      })
    );
  });

  it("generates promotion links and reports unavailable items as no_results", async () => {
    const { client, posthog } = createClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(200, { data: { promotionLink: "https://vt.tiktok.com/abc123/" } }))
      .mockResolvedValueOnce(createResponse(404, {}));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const link = await client.generatePromotionLink({ productId: "987654321" });
    expect(link).toMatchObject({
      productId: "987654321",
      platformProductId: "tiktok_shop:987654321",
      promotionLink: "https://vt.tiktok.com/abc123/",
    });

    await expect(client.generatePromotionLink({ productId: "222" })).rejects.toMatchObject({ code: "no_results" });
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_api_call",
      expect.objectContaining({
        platform: "tiktok_shop",
        operation: "generatePromotionLink",
        status: "success",
        outcome: "live",
      })
    );
  });
});
