import { type ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessTradePublisherClient } from "../client";
import { AccessTradeRateLimitGuard } from "../rate-limit-guard";

function createResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as Response;
}

function createClient(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    ACCESSTRADE_REGION: "VN",
    ACCESSTRADE_BASE_URL: "https://example.test/accesstrade/v1",
    ACCESSTRADE_ACCESS_KEY: "access-key",
    ACCESSTRADE_REQUEST_TIMEOUT_MS: "1000",
    ...overrides,
  };

  const cfg = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`Missing config: ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;

  const rateLimit = { acquire: vi.fn().mockResolvedValue(undefined) } as unknown as AccessTradeRateLimitGuard;
  const sentry = { addBreadcrumb: vi.fn(), captureException: vi.fn() };
  const posthog = { capture: vi.fn() };

  return { client: new AccessTradePublisherClient(cfg, rateLimit, sentry, posthog), rateLimit, sentry, posthog };
}

describe("FR-AFF-007 — AccessTradePublisherClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("lists campaigns and strips HTML before returning them", async () => {
    const { client, rateLimit, posthog } = createClient();
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse(200, {
        data: [
          {
            id: "5585194803623188142",
            name: "<p>Citibank New</p>",
            merchant: "<span>citibank_new</span>",
            url: "https://www.citibank.com.vn/vietnamese/form/uu-dai-mo-the-tin-dung/index.htm",
            approval: "successful",
            scope: "<em>private</em>",
            status: 1,
            cookieDuration: 30,
          },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const campaigns = await client.listCampaigns({ approval: "successful" });

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({
      name: "Citibank New",
      merchant: "citibank_new",
      approval: "successful",
      scope: "private",
      cookieDuration: 30,
    });
    expect(rateLimit.acquire).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_api_call",
      expect.objectContaining({
        platform: "accesstrade",
        operation: "listCampaigns",
        status: "success",
        outcome: "live",
      }),
    );
  });

  it("creates tracking links and prefers short_link", async () => {
    const { client, posthog } = createClient();
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse(200, {
        success: true,
        data: {
          success_link: [
            {
              aff_link: "https://tracking.dev.accesstrade.me/deep_link/123/456?utm_campaign=default&sub1=salenoti",
              short_link: "https://shorten.dev.accesstrade.me/ujrBHxpc",
              url_origin: "https://merchant.example/product",
            },
          ],
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const link = await client.createTrackingLink({
      campaignId: "5585194803623188142",
      urls: ["https://merchant.example/product"],
      utmSource: "salenoti",
      utmMedium: "affiliate_fallback",
      utmCampaign: "default",
      utmContent: "share_deal",
      subIds: { sub1: "userhash", sub2: "watchhash", sub3: "share_deal", sub4: "default" },
    });

    expect(link).toMatchObject({
      campaignId: "5585194803623188142",
      originUrl: "https://merchant.example/product",
      shortLink: "https://shorten.dev.accesstrade.me/ujrBHxpc",
      affiliateLink: "https://tracking.dev.accesstrade.me/deep_link/123/456?utm_campaign=default&sub1=salenoti",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_api_call",
      expect.objectContaining({
        platform: "accesstrade",
        operation: "createTrackingLink",
        status: "success",
        outcome: "live",
      }),
    );
  });
});
