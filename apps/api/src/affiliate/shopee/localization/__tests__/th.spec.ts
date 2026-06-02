import { describe, expect, it } from "vitest";
import { AFFILIATE_DISCLOSURE_TH, FIVE_PRINCIPLES_TH } from "@salenoti/disclosure-copy";
import { formatShopeeThailandCurrency, resolveShopeeThailandMarket, SHOPEE_THAILAND_MARKET } from "../th";
import { getShopeeThailandKocRoster } from "../koc-roster";

describe("FR-AFF-009 — Shopee Thailand localization helpers", () => {
  it("resolves the Thailand market descriptor", () => {
    const config = resolveShopeeThailandMarket({ locale: "th_TH" });

    expect(config).toMatchObject({
      market: "TH",
      locale: "th_TH",
      language: "th",
      currency: "THB",
      currencySymbol: "฿",
      disclosureCopy: AFFILIATE_DISCLOSURE_TH,
      principles: FIVE_PRINCIPLES_TH,
    });
  });

  it("formats THB for display only", () => {
    const formatted = formatShopeeThailandCurrency(129900);

    expect(formatted).toContain("129");
    expect(formatted).toContain("฿");
  });

  it("exposes a frozen KOC roster without PII", () => {
    const roster = getShopeeThailandKocRoster();

    expect(Object.isFrozen(roster)).toBe(true);
    expect(roster).toBe(SHOPEE_THAILAND_MARKET.kocRoster);
    expect(roster.length).toBeGreaterThan(0);
    expect(roster[0]).toMatchObject({ respectOtherPublisher: true });
  });
});
