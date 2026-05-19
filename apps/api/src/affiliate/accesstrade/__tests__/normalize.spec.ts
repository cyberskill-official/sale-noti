import { describe, expect, it } from "vitest";
import { normalizeAccessTradeCampaign, normalizeAccessTradeTrackingLink } from "../normalize";

describe("FR-AFF-007 — normalizeAccessTradeCampaign", () => {
  it("strips HTML and keeps stable summary fields", () => {
    const campaign = normalizeAccessTradeCampaign({
      id: "5585194803623188142",
      name: "<p>Citibank New</p>",
      merchant: "<span>citibank_new</span>",
      url: "https://www.citibank.com.vn/vietnamese/form/uu-dai-mo-the-tin-dung/index.htm",
      approval: "successful",
      scope: "<em>private</em>",
      status: 1,
      cookieDuration: 30,
      descriptionHtml: "<p>Thời gian lưu cookie 30 ngày</p>",
    });

    expect(campaign).toMatchObject({
      id: "5585194803623188142",
      name: "Citibank New",
      merchant: "citibank_new",
      approval: "successful",
      scope: "private",
      status: 1,
      cookieDuration: 30,
    });
  });
});

describe("FR-AFF-007 — normalizeAccessTradeTrackingLink", () => {
  it("prefers short_link over aff_link", () => {
    const link = normalizeAccessTradeTrackingLink(
      {
        success: true,
        data: {
          success_link: [
            {
              aff_link: "https://tracking.dev.accesstrade.me/deep_link/123/456",
              short_link: "https://shorten.dev.accesstrade.me/ujrBHxpc",
              url_origin: "https://merchant.example/product",
            },
          ],
        },
      },
      "5585194803623188142",
      "https://merchant.example/product",
    );

    expect(link).toMatchObject({
      campaignId: "5585194803623188142",
      originUrl: "https://merchant.example/product",
      affiliateLink: "https://tracking.dev.accesstrade.me/deep_link/123/456",
      shortLink: "https://shorten.dev.accesstrade.me/ujrBHxpc",
    });
  });
});
