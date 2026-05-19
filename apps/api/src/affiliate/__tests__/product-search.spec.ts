import crypto from "node:crypto";
import fs from "node:fs";
import { BadRequestException, HttpException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isProductSearchSort,
  ProductSearchRateLimitError,
  ProductSearchService,
  scrubKeyword,
  stripHtml,
} from "../product-search.service";
import { ProductSearchController } from "../product-search.controller";

const state = vi.hoisted(() => ({
  redisStore: new Map<string, string>(),
  redisCounters: new Map<string, number>(),
  redis: {
    get: vi.fn(async (key: string) => state.redisStore.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      state.redisStore.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = (state.redisCounters.get(key) ?? 0) + 1;
      state.redisCounters.set(key, next);
      return next;
    }),
    expire: vi.fn(async (_key: string, _ttl: number) => 1),
  },
  affiliateLinks: {
    find: vi.fn(),
  },
}));

vi.mock("../../queue/redis.client", () => ({
  redis: state.redis,
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "affiliate_links") return state.affiliateLinks;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

function shopeeNode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    shopId: "123",
    itemId: "9876",
    productName: "Áo <b>thun</b> nam",
    priceMin: 89_000,
    priceMax: 129_000,
    productLink: "https://shopee.vn/ao-thun-i.123.9876",
    commissionRate: 0.03,
    sales: 1247,
    imageUrl: "https://cf.shopee.vn/file/example",
    ...overrides,
  };
}

function makeService() {
  const shopee = {
    productSearch: vi.fn(async () => ({ nodes: [shopeeNode()] })),
  };
  const posthog = { capture: vi.fn() };
  const service = new ProductSearchService(shopee as any, posthog);
  return { service, shopee, posthog };
}

function mockAffiliateLinks(rows: Array<Record<string, unknown>>) {
  const toArray = vi.fn(async () => rows);
  const sort = vi.fn(() => ({ toArray }));
  state.affiliateLinks.find.mockReturnValue({ sort });
  return { sort, toArray };
}

function expectBadRequest(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({
    response: expect.objectContaining({ message: code }),
  });
}

function makeJwt(
  sub: string | undefined,
  secret: string,
  claims: Partial<{ iat: number; exp: number }> = {},
  signingSecret = secret,
) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      iat: claims.iat ?? Math.floor(Date.now() / 1000),
      exp: claims.exp ?? Math.floor(Date.now() / 1000) + 900,
    }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", signingSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

describe("FR-AFF-004 — ProductSearchService contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.redisStore.clear();
    state.redisCounters.clear();
    state.redis.get.mockClear();
    state.redis.setex.mockClear();
    state.redis.incr.mockClear();
    state.redis.expire.mockClear();
    state.affiliateLinks.find = vi.fn();
    mockAffiliateLinks([]);
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = "test";
  });

  it("AC1+2+3+9: fetches Shopee once, caches for 5 minutes, and defaults to RELEVANCY", async () => {
    const { service, shopee, posthog } = makeService();

    const first = await service.search({ keyword: " áo thun " }, { ip: "203.0.113.8" });
    const second = await service.search({ keyword: "áo thun" }, { ip: "203.0.113.9" });

    expect(first).toMatchObject({
      cached: false,
      count: 1,
      pageNumber: 1,
      pageSize: 10,
      sort: "RELEVANCY",
      items: [{ productName: "Áo thun nam", currentPrice: 89_000, originalPrice: 129_000 }],
    });
    expect(second.cached).toBe(true);
    expect(shopee.productSearch).toHaveBeenCalledTimes(1);
    expect(shopee.productSearch).toHaveBeenCalledWith({
      keyword: "áo thun",
      pageNumber: 1,
      pageSize: 10,
      sort: "RELEVANCY",
    });
    expect(state.redis.setex).toHaveBeenCalledWith(expect.stringMatching(/^product_search:[a-f0-9]{16}$/), 300, expect.any(String));
    expect(posthog.capture).toHaveBeenLastCalledWith(
      "product_search",
      expect.objectContaining({ keyword: "áo thun", cached: true, results: 1, sort: "RELEVANCY" }),
    );
  });

  it("AC6+7+8+13: validates keyword, page size, page number, and sort as a closed enum", async () => {
    const { service } = makeService();

    await expectBadRequest(service.search({ keyword: " " }), "invalid_keyword");
    await expectBadRequest(service.search({ keyword: "x".repeat(201) }), "keyword_too_long");
    await expectBadRequest(service.search({ keyword: "x", pageSize: 50 }), "invalid_pageSize");
    await expectBadRequest(service.search({ keyword: "x", pageSize: 1.5 }), "invalid_pageSize");
    await expectBadRequest(service.search({ keyword: "x", pageNumber: 0 }), "invalid_pageNumber");
    await expectBadRequest(service.search({ keyword: "x", pageNumber: 51 }), "invalid_pageNumber");
    await expectBadRequest(service.search({ keyword: "x", sort: "COMMISSION_DESC" as any }), "invalid_sort");
    expect(isProductSearchSort("SALES_DESC")).toBe(true);
    expect(isProductSearchSort("COMMISSION_DESC")).toBe(false);
  });

  it("AC4+5: rate-limits authenticated users and anonymous /24 buckets", async () => {
    const { service, shopee } = makeService();

    state.redis.incr.mockResolvedValueOnce(31);
    await expect(service.search({ keyword: "áo" }, { userIdRaw: "user-1" })).rejects.toBeInstanceOf(
      ProductSearchRateLimitError,
    );
    expect(state.redis.incr).toHaveBeenCalledWith(expect.stringContaining("rl:search:user:user-1:"));

    state.redis.incr.mockResolvedValueOnce(11);
    await expect(service.search({ keyword: "giày" }, { ip: "203.0.113.44" })).rejects.toBeInstanceOf(
      ProductSearchRateLimitError,
    );
    expect(state.redis.incr).toHaveBeenLastCalledWith(expect.stringContaining("rl:search:ip:203.0.113:"));

    await service.search({ keyword: "balo" }, { ip: "localhost" });
    expect(state.redis.incr).toHaveBeenLastCalledWith(expect.stringContaining("rl:search:ip:0.0.0:"));
    expect(shopee.productSearch).toHaveBeenCalledTimes(1);
  });

  it("AC10+11+12+13+14: strips HTML and redacts PII-shaped keywords before analytics", async () => {
    const { service, shopee, posthog } = makeService();
    shopee.productSearch.mockResolvedValue({ nodes: [shopeeNode({ productName: "<script>alert(1)</script>OK" })] });

    const result = await service.search({ keyword: "xss" });

    expect(stripHtml("<style>bad</style><b>Áo</b>")).toBe("Áo");
    expect(result.items[0]?.productName).toBe("OK");
    expect(scrubKeyword("u@example.com áo")).toBe("[redacted-email]");
    expect(scrubKeyword("0901234567")).toBe("[redacted-phone]");
    expect(scrubKeyword("012345678901")).toBe("[redacted-id]");
    expect(scrubKeyword("áo thun nam basic giảm giá")).toBe("áo thun nam basic giảm giá");
    expect(scrubKeyword("x".repeat(100))).toHaveLength(60);

    await service.search({ keyword: "u@example.com xanh" });
    await service.search({ keyword: "0901234567" });
    await service.search({ keyword: "012345678901" });
    const captured = posthog.capture.mock.calls.map(([, properties]) => properties.keyword);
    expect(captured).toEqual(["xss", "[redacted-email]", "[redacted-phone]", "[redacted-id]"]);
  });

  it("AC17+18: enriches authenticated rows with existing affiliate links using one batched query", async () => {
    const { service } = makeService();
    const userId = "665000000000000000000001";
    mockAffiliateLinks([
      { productId: "123-9876", shortUrl: "https://shope.ee/LATEST" },
      { productId: "123-9876", shortUrl: "https://shope.ee/OLD" },
    ]);

    const result = await service.search({ keyword: "áo" }, { userIdRaw: userId });

    expect(result.items[0]?.affiliateLinkUrl).toBe("https://shope.ee/LATEST");
    expect(state.affiliateLinks.find).toHaveBeenCalledWith({
      userId: new ObjectId(userId),
      productId: { $in: ["123-9876"] },
    });

    state.affiliateLinks.find.mockClear();
    const anonymous = await service.search({ keyword: "giày" });
    expect(anonymous.items[0]?.affiliateLinkUrl).toBeNull();
    expect(state.affiliateLinks.find).not.toHaveBeenCalled();

    mockAffiliateLinks([{ productId: "123-9876", shortUrl: "https://shope.ee/LEGACY" }]);
    const legacy = await service.search({ keyword: "balo" }, { userIdRaw: "legacy-user-id" });
    expect(legacy.items[0]?.affiliateLinkUrl).toBe("https://shope.ee/LEGACY");
    expect(state.affiliateLinks.find).toHaveBeenLastCalledWith({
      userId: "legacy-user-id",
      productId: { $in: ["123-9876"] },
    });
  });

  it("AC15: does not add commission-rate ranking hooks", () => {
    const source = fs.readFileSync("src/affiliate/product-search.service.ts", "utf8");

    const forbiddenTerm = "comm" + "ission";
    expect(source).not.toMatch(new RegExp(`ORDER BY[\\s\\S]*${forbiddenTerm}`, "i"));
    expect(source).not.toMatch(new RegExp(`sortBy.*${forbiddenTerm}`, "i"));
    expect(source).not.toMatch(new RegExp(`sort.*${forbiddenTerm}Rate`, "i"));
  });
});

describe("FR-AFF-004 — ProductSearchController contract", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_SECRET;
  });

  it("passes trusted local user context, hashed analytics id, and forwarded IP to the service", async () => {
    const search = {
      search: vi.fn(async () => ({ items: [], count: 0, pageNumber: 2, pageSize: 20, sort: "PRICE_ASC", cached: false })),
    };
    const controller = new ProductSearchController(search as any);

    await controller.list(
      { q: "áo", page: "2", size: "20", sort: "PRICE_ASC" },
      undefined,
      "user-1",
      "203.0.113.44, 10.0.0.1",
      undefined,
      { ip: "127.0.0.1" } as any,
      { setHeader: vi.fn() } as any,
    );

    expect(search.search).toHaveBeenCalledWith(
      { keyword: "áo", pageNumber: 2, pageSize: 20, sort: "PRICE_ASC" },
      { userIdHash: expect.stringMatching(/^[a-f0-9]{16}$/), userIdRaw: "user-1", ip: "203.0.113.44" },
    );
  });

  it("uses signed bearer subject in production instead of trusting x-user-id", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    process.env.AUTH_SECRET = secret;
    process.env.NODE_ENV = "production";
    const search = { search: vi.fn(async () => ({ items: [], count: 0, pageNumber: 1, pageSize: 10, sort: "RELEVANCY", cached: false })) };
    const controller = new ProductSearchController(search as any);

    await controller.list(
      { q: "áo" },
      `Bearer ${makeJwt("jwt-user", secret)}`,
      "spoofed-user",
      undefined,
      "198.51.100.5",
      { ip: "127.0.0.1" } as any,
      { setHeader: vi.fn() } as any,
    );

    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: "áo" }),
      expect.objectContaining({ userIdRaw: "jwt-user", ip: "198.51.100.5" }),
    );
  });

  it("maps validation errors to the FR response codes", async () => {
    const controller = new ProductSearchController({ search: vi.fn() } as any);

    await expect(
      controller.list({ q: "   " }, undefined, undefined, undefined, undefined, { ip: "127.0.0.1" } as any, {
        setHeader: vi.fn(),
      } as any),
    ).rejects.toMatchObject({ response: { error: "invalid_keyword" }, status: 400 });

    await expect(
      controller.list({ q: "áo", size: "50" }, undefined, undefined, undefined, undefined, { ip: "127.0.0.1" } as any, {
        setHeader: vi.fn(),
      } as any),
    ).rejects.toMatchObject({ response: { error: "invalid_pageSize" }, status: 400 });

    await expect(
      controller.list(
        { q: "x".repeat(201) },
        undefined,
        undefined,
        undefined,
        undefined,
        { ip: "127.0.0.1" } as any,
        { setHeader: vi.fn() } as any,
      ),
    ).rejects.toMatchObject({ response: { error: "keyword_too_long" }, status: 400 });

    await expect(
      controller.list({ q: "áo", page: "0" }, undefined, undefined, undefined, undefined, { ip: "127.0.0.1" } as any, {
        setHeader: vi.fn(),
      } as any),
    ).rejects.toMatchObject({ response: { error: "invalid_pageNumber" }, status: 400 });

    await expect(
      controller.list(
        { q: "áo", sort: "COMMISSION_DESC" },
        undefined,
        undefined,
        undefined,
        undefined,
        { ip: "127.0.0.1" } as any,
        { setHeader: vi.fn() } as any,
      ),
    ).rejects.toMatchObject({ response: { error: "invalid_sort" }, status: 400 });

    await expect(
      controller.list("bad-query" as any, undefined, undefined, undefined, undefined, { ip: "127.0.0.1" } as any, {
        setHeader: vi.fn(),
      } as any),
    ).rejects.toMatchObject({ response: { error: "validation_failed" }, status: 400 });
  });

  it("maps product search rate limits to HTTP 429 with Retry-After", async () => {
    const search = { search: vi.fn(async () => {
      throw new ProductSearchRateLimitError();
    }) };
    const response = { setHeader: vi.fn() };
    const controller = new ProductSearchController(search as any);

    await expect(
      controller.list({ q: "áo" }, undefined, undefined, undefined, undefined, { ip: "127.0.0.1" } as any, response as any),
    ).rejects.toMatchObject({ response: { error: "rate_limit", retryAfter: 60 }, status: 429 });
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "60");
  });

  it("passes through non-rate-limit service errors", async () => {
    const error = new BadRequestException("service_validation");
    const search = { search: vi.fn(async () => {
      throw error;
    }) };
    const controller = new ProductSearchController(search as any);

    await expect(
      controller.list({ q: "áo" }, undefined, undefined, undefined, undefined, { ip: "127.0.0.1" } as any, {
        setHeader: vi.fn(),
      } as any),
    ).rejects.toBe(error);
  });

  it("keeps anonymous production searches anonymous and falls back to request IP", async () => {
    process.env.NODE_ENV = "production";
    const search = { search: vi.fn(async () => ({ items: [], count: 0, pageNumber: 1, pageSize: 10, sort: "RELEVANCY", cached: false })) };
    const controller = new ProductSearchController(search as any);

    await controller.list(
      { q: "áo" },
      "Bearer malformed",
      "spoofed-user",
      undefined,
      undefined,
      { ip: "192.0.2.10" } as any,
      { setHeader: vi.fn() } as any,
    );

    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: "áo" }),
      { userIdHash: undefined, userIdRaw: undefined, ip: "192.0.2.10" },
    );
  });

  it("rejects malformed, tampered, missing-sub, and expired bearer tokens as anonymous", async () => {
    process.env.NODE_ENV = "production";
    const secret = "0123456789abcdef0123456789abcdef";
    process.env.AUTH_SECRET = secret;
    const search = { search: vi.fn(async () => ({ items: [], count: 0, pageNumber: 1, pageSize: 10, sort: "RELEVANCY", cached: false })) };
    const controller = new ProductSearchController(search as any);
    const now = Math.floor(Date.now() / 1000);
    const tokens = [
      "malformed.token",
      makeJwt("bad-signature", secret, {}, "fedcba9876543210fedcba9876543210"),
      makeJwt(undefined, secret),
      makeJwt("expired-user", secret, { exp: now - 120 }),
      makeJwt("future-user", secret, { iat: now + 120 }),
    ];

    for (const token of tokens) {
      await controller.list(
        { q: "áo" },
        `Bearer ${token}`,
        undefined,
        "",
        undefined,
        {} as any,
        { setHeader: vi.fn() } as any,
      );
    }

    for (const call of search.search.mock.calls as unknown as Array<[unknown, unknown]>) {
      expect(call[1]).toEqual({ userIdHash: undefined, userIdRaw: undefined, ip: "0.0.0.0" });
    }
  });
});
