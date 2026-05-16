// FR-LEGAL-002 §5 — snapshot test catches drift in the canonical disclosure copy.
import { describe, it, expect } from "vitest";
import { renderMagicLinkEmail } from "@/server/email/templates/magic-link";
import { AFFILIATE_DISCLOSURE_VI, AFFILIATE_DISCLOSURE_EN, DISCLOSURE_VERSION } from "@/lib/disclosure";

describe("FR-LEGAL-002 — canonical disclosure", () => {
  it("AC3: magic-link email body contains the Vi disclosure verbatim", () => {
    const { html, text } = renderMagicLinkEmail({ url: "https://salenoti.vn/...", email: "u@example.com" });
    expect(html).toContain(AFFILIATE_DISCLOSURE_VI);
    expect(text).toContain(AFFILIATE_DISCLOSURE_VI);
  });

  it("Vi disclosure contains all 3 'do not' commitments", () => {
    expect(AFFILIATE_DISCLOSURE_VI).toContain("tự áp coupon");
    expect(AFFILIATE_DISCLOSURE_VI).toContain("override cookie affiliate");
    expect(AFFILIATE_DISCLOSURE_VI).toContain("ẩn deal tốt hơn");
  });

  it("En disclosure contains all 3 'do not' commitments", () => {
    expect(AFFILIATE_DISCLOSURE_EN).toContain("auto-apply coupons");
    expect(AFFILIATE_DISCLOSURE_EN).toContain("override affiliate cookies");
    expect(AFFILIATE_DISCLOSURE_EN).toContain("hide better deals");
  });

  it("Disclosure version is v1 (bumping requires a new FR)", () => {
    expect(DISCLOSURE_VERSION).toBe("v1");
  });
});
