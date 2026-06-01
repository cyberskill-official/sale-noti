import { describe, expect, it, vi } from "vitest";
import {
  applyTenantObservabilityTags,
  observabilityScopeFromPathname,
  observabilityScopeFromSamplerContext,
  traceSampleRateForScope,
} from "@/server/obs/tenant";

describe("FR-OBS-002 — tenant observability helpers", () => {
  it("classifies B2B routes for sampling", () => {
    expect(observabilityScopeFromPathname("/dashboard")).toBe("b2b");
    expect(observabilityScopeFromPathname("GET /api/admin/products/search")).toBe("b2b");
    expect(observabilityScopeFromPathname("/auth/sign-in")).toBe("public");
  });

  it("prefers the observability header when the middleware stamps it", () => {
    expect(
      observabilityScopeFromSamplerContext({
        request: {
          headers: new Headers({ "x-observability-scope": "b2b" }),
          url: "https://sale.cyber.skill/auth/sign-in",
        },
      }),
    ).toBe("b2b");
  });

  it("falls back to request and transaction names when the header is absent", () => {
    expect(
      observabilityScopeFromSamplerContext({
        request: { url: "https://sale.cyber.skill/dashboard" },
      }),
    ).toBe("b2b");

    expect(
      observabilityScopeFromSamplerContext({
        transactionContext: { name: "GET /api/admin/products/search" },
      }),
    ).toBe("b2b");

    expect(
      observabilityScopeFromSamplerContext({
        transactionContext: { name: "GET /auth/sign-in" },
      }),
    ).toBe("public");
  });

  it("returns 100% sampling for B2B and keeps the public fallback configurable", () => {
    expect(traceSampleRateForScope("b2b", 0.1)).toBe(1);
    expect(traceSampleRateForScope("public", 0.25)).toBe(0.25);
  });

  it("tags tenant scope metadata on the active Sentry scope", () => {
    const target = { setTag: vi.fn() };

    applyTenantObservabilityTags(target, {
      scope: "b2b",
      tenantId: "seller_123",
      subscriptionId: "sub_456",
      tier: "growth",
    });

    expect(target.setTag).toHaveBeenCalledWith("tenant_scope", "b2b");
    expect(target.setTag).toHaveBeenCalledWith("tenant_id", "seller_123");
    expect(target.setTag).toHaveBeenCalledWith("tenant_subscription_id", "sub_456");
    expect(target.setTag).toHaveBeenCalledWith("tenant_tier", "growth");
  });
});
