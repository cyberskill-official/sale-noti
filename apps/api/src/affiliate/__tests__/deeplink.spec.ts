import crypto from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeeplinkRateLimitError, DeeplinkService } from "../deeplink.service";
import { ShopeeApiError } from "../shopee/errors";

const state = vi.hoisted(() => ({
  products: {
    findOne: vi.fn(),
  },
  affiliateLinks: {
    insertOne: vi.fn(),
    updateOne: vi.fn(),
  },
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "products") return state.products;
        if (name === "affiliate_links") return state.affiliateLinks;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

vi.mock("../../queue/redis.client", () => ({
  redis: state.redis,
}));

function makeHarness() {
  const shopee = {
    generateShortLink: vi.fn(async () => ({ shortLink: "https://shope.ee/AbCdEf" })),
  };
  const accessTradeFallback = {
    generateFallbackLink: vi.fn(async () => ({ url: "https://at.example/fallback", expiresAt: null, cached: false })),
  };
  const cfg = {
    getOrThrow: vi.fn((key: string) => {
      if (key === "DEEPLINK_SALT") return "0123456789abcdef0123456789abcdef";
      throw new Error(`missing ${key}`);
    }),
    get: vi.fn((key: string) => {
      if (key === "ACCESSTRADE_FALLBACK_ENABLED") return "false";
      return undefined;
    }),
  };
  const posthog = { capture: vi.fn() };
  const service = new DeeplinkService(shopee as any, cfg as any, posthog, accessTradeFallback as any);
  (service as any).sleep = vi.fn(async () => undefined);
  return { service, shopee, cfg, posthog, accessTradeFallback };
}

function seedProduct(url = "https://shopee.vn/ao-thun-i.123456.9876543210") {
  state.products.findOne.mockResolvedValue({ affiliateLink: url });
}

describe("FR-AFF-002 — DeeplinkService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.products.findOne = vi.fn();
    state.affiliateLinks.insertOne = vi.fn(async () => ({ insertedId: "link-1" }));
    state.affiliateLinks.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.redis.get = vi.fn(async () => null);
    state.redis.set = vi.fn(async () => "OK");
    state.redis.setex = vi.fn(async () => "OK");
    state.redis.del = vi.fn(async () => 1);
    state.redis.incr = vi.fn(async () => 1);
    state.redis.expire = vi.fn(async () => 1);
    seedProduct();
  });

  it("generates a short URL, persists five subIds, caches it, and emits safe analytics", async () => {
    const { service, shopee, posthog } = makeHarness();
    const userId = "65f8a2b3c4d5e6f7a8b9c0d1";
    const watchlistId = "75f8a2b3c4d5e6f7a8b9c0d2";
    const expectedUserHash = crypto
      .createHash("sha256")
      .update(userId + "0123456789abcdef0123456789abcdef")
      .digest("hex")
      .slice(0, 12);

    const result = await service.generate({
      userId,
      productId: "123456-9876543210",
      source: "alert_email",
      watchlistId,
      campaign: "mega-sale",
    });

    expect(result).toEqual({ url: "https://shope.ee/AbCdEf", expiresAt: null, cached: false });
    expect(shopee.generateShortLink).toHaveBeenCalledWith({
      originUrl: "https://shopee.vn/ao-thun-i.123456.9876543210",
      subIds: ["salenoti", expectedUserHash, expect.stringMatching(/^[a-f0-9]{8}$/), "alert_email", "mega-sale"],
    });
    expect(state.affiliateLinks.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "123456-9876543210",
        subIds: ["salenoti", expectedUserHash, expect.stringMatching(/^[a-f0-9]{8}$/), "alert_email", "mega-sale"],
        originUrl: "https://shopee.vn/ao-thun-i.123456.9876543210",
        shortUrl: "https://shope.ee/AbCdEf",
        respectOtherPublisher: false,
      }),
    );
    expect(state.redis.setex).toHaveBeenCalledWith(
      "dl:65f8a2b3c4d5e6f7a8b9c0d1:123456-9876543210:alert_email:mega-sale",
      86_400,
      "https://shope.ee/AbCdEf",
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_link_generated",
      expect.objectContaining({
        userIdHash: expect.stringMatching(/^[a-f0-9]{12}$/),
        productIdHash: expect.stringMatching(/^[a-f0-9]{12}$/),
        cached: false,
        respect_other_publisher: false,
        latency_ms: expect.any(Number),
      }),
    );
    expect(JSON.stringify(posthog.capture.mock.calls)).not.toContain("shope.ee");
    expect(JSON.stringify(posthog.capture.mock.calls)).not.toContain(userId);
  });

  it("returns cached links without calling Shopee and increments cacheHits", async () => {
    const { service, shopee, posthog } = makeHarness();
    state.redis.get.mockResolvedValueOnce("https://shope.ee/Cached");

    const result = await service.generate({
      userId: "user-1",
      productId: "123456-9876543210",
      source: "ext",
      campaign: "default",
    });

    expect(result).toEqual({ url: "https://shope.ee/Cached", expiresAt: null, cached: true });
    expect(shopee.generateShortLink).not.toHaveBeenCalled();
    expect(state.affiliateLinks.updateOne).toHaveBeenCalledWith(
      { shortUrl: "https://shope.ee/Cached", userId: "user-1" },
      { $inc: { cacheHits: 1 } },
    );
    expect(posthog.capture).toHaveBeenCalledWith("affiliate_link_generated", expect.objectContaining({ cached: true }));
  });

  it("rejects invalid origin URLs and productId mismatches", async () => {
    const { service } = makeHarness();
    seedProduct("https://tiki.vn/x-i.123456.9876543210");
    await expect(
      service.generate({ userId: "user-1", productId: "123456-9876543210", source: "ext" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    seedProduct("https://shopee.vn/ao-thun-i.999.888");
    await expect(
      service.generate({ userId: "user-1", productId: "123456-9876543210", source: "ext" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("respects other publishers by returning origin URL and persisting an audit row", async () => {
    const { service, shopee, posthog } = makeHarness();

    const result = await service.generate({
      userId: "user-1",
      productId: "123456-9876543210",
      source: "ext",
      respectOtherPublisher: true,
    });

    expect(result.url).toBe("https://shopee.vn/ao-thun-i.123456.9876543210");
    expect(shopee.generateShortLink).not.toHaveBeenCalled();
    expect(state.affiliateLinks.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        shortUrl: "https://shopee.vn/ao-thun-i.123456.9876543210",
        subIds: ["salenoti", expect.stringMatching(/^[a-f0-9]{12}$/), "0", "ext", "respected"],
        respectOtherPublisher: true,
      }),
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_link_respected_publisher",
      expect.objectContaining({ source: "ext", userIdHash: expect.stringMatching(/^[a-f0-9]{12}$/) }),
    );
  });

  it("scrubs campaigns, enforces rate limits, and absorbs parallel lease races", async () => {
    const { service, shopee } = makeHarness();
    await service.generate({
      userId: "user-1",
      productId: "123456-9876543210",
      source: "deal_page",
      campaign: "evil!@#$%abc_longer_than_twenty_chars",
    });
    expect(state.affiliateLinks.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ campaign: "evilabc_longer_than_" }),
    );

    state.redis.incr.mockResolvedValueOnce(31);
    await expect(
      service.generate({ userId: "user-1", productId: "123456-9876543210", source: "ext" }),
    ).rejects.toBeInstanceOf(DeeplinkRateLimitError);

    state.redis.incr.mockResolvedValueOnce(1);
    state.redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce("https://shope.ee/Racer");
    state.redis.set.mockResolvedValueOnce(null);
    await expect(
      service.generate({ userId: "user-1", productId: "123456-9876543210", source: "ext" }),
    ).resolves.toEqual({ url: "https://shope.ee/Racer", expiresAt: null, cached: true });
    expect(shopee.generateShortLink).toHaveBeenCalledTimes(1);
  });

  it("falls back to AccessTrade on retryable Shopee failures when enabled", async () => {
    const { service, shopee, accessTradeFallback, posthog } = makeHarness();
    (service as any).cfg.get.mockImplementation((key: string) => {
      if (key === "ACCESSTRADE_FALLBACK_ENABLED") return "true";
      return undefined;
    });
    shopee.generateShortLink.mockRejectedValueOnce(new ShopeeApiError("service_unavailable", "Shopee 503", true));

    const result = await service.generate({
      userId: "user-1",
      productId: "123456-9876543210",
      source: "share_deal",
      watchlistId: "watch-1",
      campaign: "default",
    });

    expect(result).toEqual({ url: "https://at.example/fallback", expiresAt: null, cached: false });
    expect(accessTradeFallback.generateFallbackLink).toHaveBeenCalledWith(
      expect.objectContaining({
        originUrl: "https://shopee.vn/ao-thun-i.123456.9876543210",
        userId: "user-1",
        source: "share_deal",
        watchlistId: "watch-1",
        campaign: "default",
        respectOtherPublisher: false,
      }),
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "affiliate_link_generated",
      expect.objectContaining({ cached: false, respect_other_publisher: false }),
    );
  });
});
