import crypto from "node:crypto";
import { type ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessTradeFallbackService } from "../fallback.service";
import { AccessTradePublisherClient } from "../client";

function createHarness(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    DEEPLINK_SALT: "0123456789abcdef0123456789abcdef",
    ACCESSTRADE_DEFAULT_CAMPAIGN_ID: "5585194803623188142",
    ...overrides,
  };

  const cfg = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`Missing config: ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;

  const client = {
    listCampaigns: vi.fn(),
    createTrackingLink: vi.fn(),
  } as unknown as AccessTradePublisherClient;

  return {
    service: new AccessTradeFallbackService(cfg, client),
    client,
    cfg,
  };
}

describe("FR-AFF-007 — AccessTradeFallbackService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps attribution into AccessTrade fields and prefers short_link", async () => {
    const { service, client } = createHarness();
    vi.mocked(client.listCampaigns).mockResolvedValue([
      {
        id: "5585194803623188142",
        name: "Citibank New",
        merchant: "citibank_new",
        url: "https://merchant.example/campaign",
        approval: "successful",
        scope: "private",
        status: 1,
        cookieDuration: 30,
      },
    ]);
    vi.mocked(client.createTrackingLink).mockResolvedValue({
      campaignId: "5585194803623188142",
      originUrl: "https://merchant.example/product",
      affiliateLink: "https://tracking.dev.accesstrade.me/deep_link/123/456",
      shortLink: "https://shorten.dev.accesstrade.me/ujrBHxpc",
      generatedAt: new Date().toISOString(),
    });

    const result = await service.generateFallbackLink({
      originUrl: "https://merchant.example/product",
      userId: "user-1",
      watchlistId: "watch-1",
      source: "share_deal",
      campaign: "default",
    });

    const expectedUserHash = crypto
      .createHash("sha256")
      .update("user-1" + "0123456789abcdef0123456789abcdef")
      .digest("hex")
      .slice(0, 12);

    expect(vi.mocked(client.listCampaigns)).toHaveBeenCalledWith({ approval: "successful" });
    expect(vi.mocked(client.createTrackingLink)).toHaveBeenCalledWith({
      campaignId: "5585194803623188142",
      urls: ["https://merchant.example/product"],
      utmSource: "salenoti",
      utmMedium: "affiliate_fallback",
      utmCampaign: "default",
      utmContent: "share_deal",
      subIds: {
        sub1: expectedUserHash,
        sub2: expect.stringMatching(/^[a-f0-9]{8}$/),
        sub3: "share_deal",
        sub4: "default",
      },
    });
    expect(result).toEqual({ url: "https://shorten.dev.accesstrade.me/ujrBHxpc", expiresAt: null, cached: false });
  });

  it("returns raw origin URL when respectOtherPublisher is true", async () => {
    const { service, client } = createHarness();

    const result = await service.generateFallbackLink({
      originUrl: "https://merchant.example/product",
      userId: "user-1",
      source: "ext",
      respectOtherPublisher: true,
    });

    expect(result).toEqual({ url: "https://merchant.example/product", expiresAt: null, cached: false });
    expect(vi.mocked(client.listCampaigns)).not.toHaveBeenCalled();
    expect(vi.mocked(client.createTrackingLink)).not.toHaveBeenCalled();
  });
});
