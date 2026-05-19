import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

describe("FR-EXT-001 — Chrome MV3 static contract", () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8"));

  it("uses Manifest V3 and narrow Shopee VN host scope", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toContain("*://*.shopee.vn/*");
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(JSON.stringify(manifest)).not.toContain("/api/v4/cart");
  });

  it("injects only on Shopee product pages and ships required icons", () => {
    expect(manifest.content_scripts[0].matches).toEqual(["*://*.shopee.vn/*-i.*.*"]);
    for (const size of ["16", "48", "128"]) {
      expect(existsSync(resolve(ROOT, "public/icons", `${size}.png`))).toBe(true);
      expect(manifest.icons[size]).toBe(`icons/${size}.png`);
    }
  });

  it("requires disclosure acknowledgement before injecting tracking UI", () => {
    const content = readFileSync(resolve(ROOT, "src/content.ts"), "utf8");
    const background = readFileSync(resolve(ROOT, "src/background.ts"), "utf8");
    const onboarding = readFileSync(resolve(ROOT, "src/onboarding/onboarding.ts"), "utf8");
    expect(content).toContain("disclosureAcknowledgedAt");
    expect(content).toContain("salenoti-disclosure-required");
    expect(background).toContain("openOnboarding");
    expect(onboarding).toContain("/api/auth/disclosure-ack");
    expect(content).toContain("+ Theo dõi giá");
    expect(content).not.toMatch(/get_cart_list|autoApply|coupon/i);
  });
});
