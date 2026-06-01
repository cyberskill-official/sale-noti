import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

const authMock = vi.hoisted(() => vi.fn());
const couponServiceMock = vi.hoisted(() => ({
  listCoupons: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));
vi.mock("@/server/admin/coupon.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin/coupon.service")>()),
  couponService: couponServiceMock,
}));

describe("GET /api/admin/coupons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.com" } } as any);
  });

  it("rejects unauthenticated requests", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(new NextRequest(new URL("http://localhost/api/admin/coupons")));

    expect(response.status).toBe(401);
  });

  it("returns coupon list with parsed query params", async () => {
    couponServiceMock.listCoupons.mockResolvedValue({
      items: [],
      total: 0,
      generatedAt: "2026-06-01T00:00:00.000Z",
    });

    const request = new NextRequest(new URL("http://localhost/api/admin/coupons?q=shop&status=all&limit=10"));
    const response = await GET(request);

    expect(couponServiceMock.listCoupons).toHaveBeenCalledWith({ query: "shop", status: "all", limit: 10 });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects invalid query parameters", async () => {
    const request = new NextRequest(new URL("http://localhost/api/admin/coupons?limit=0"));
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("BAD_REQUEST");
  });
});
