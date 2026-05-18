import { describe, expect, it } from "vitest";
import { AFFILIATE_DISCLOSURE_VI } from "@salenoti/disclosure-copy";
import { renderAlertEmail } from "../render-alert-email";

describe("FR-LEGAL-002/FR-NOTIF-001 — alert email disclosure", () => {
  it("renders canonical affiliate disclosure in HTML and text output", () => {
    const email = renderAlertEmail({
      productName: "Áo khoác <test>",
      imageUrl: "https://cf.shopee.vn/file/x",
      currentPrice: 100_000,
      originalPrice: 150_000,
      currentDiscountPct: 33,
      last30dMin: 99_000,
      baselineAtTrack: 150_000,
      triggerKind: "pct_drop",
      ctaUrl: "https://salenoti.vn/api/share/click?pid=1-2",
      unsubscribeUrl: "https://salenoti.vn/dashboard/watchlists/w1?action=pause",
    });

    expect(email.html).toContain(AFFILIATE_DISCLOSURE_VI);
    expect(email.text).toContain(AFFILIATE_DISCLOSURE_VI);
    expect(email.html).toContain("<table");
    expect(email.html).not.toContain("<style");
    expect(email.html).toContain("max-width:600px");
    expect(email.html).toContain("Áo khoác &lt;test&gt;");
    expect(email.subject.length).toBeLessThanOrEqual(78);
  });

  it("renders the no-image/no-30d-min variant and truncates long subjects", () => {
    const email = renderAlertEmail({
      productName: "Áo khoác siêu dài ".repeat(10),
      imageUrl: null,
      currentPrice: 10_000,
      originalPrice: 10_000,
      currentDiscountPct: 0,
      last30dMin: null,
      baselineAtTrack: 10_000,
      triggerKind: "flash_sale",
      ctaUrl: "https://salenoti.vn/deal",
      unsubscribeUrl: "https://salenoti.vn/unsubscribe",
    });

    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("Min 30 ngày");
    expect(email.subject).toHaveLength(78);
    expect(email.subject.endsWith("...")).toBe(true);
  });
});
