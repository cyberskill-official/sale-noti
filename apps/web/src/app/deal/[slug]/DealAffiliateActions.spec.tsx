import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DealAffiliateActions,
  buildTrackProductHref,
  createAffiliateClickHandler,
  createAffiliateInterstitialClose,
} from "./DealAffiliateActions";

describe("FR-LEGAL-002 — deal affiliate CTA disclosure gate", () => {
  it("builds a safe sign-in tracking URL for product ids", () => {
    expect(buildTrackProductHref("123-456")).toBe("/auth/sign-in?action=track-product&p=123-456");
    expect(buildTrackProductHref("shop item/with spaces")).toBe(
      "/auth/sign-in?action=track-product&p=shop%20item%2Fwith%20spaces",
    );
  });

  it("routes affiliate clicks through the interstitial hook instead of direct anchor navigation", () => {
    const open = vi.fn();
    const handler = createAffiliateClickHandler(open, "/api/share/click?pid=123-456&s=abc", "Tai nghe");

    handler();

    expect(open).toHaveBeenCalledWith("/api/share/click?pid=123-456&s=abc", "Tai nghe");
  });

  it("closes the pending interstitial without leaking old click state", () => {
    const setPending = vi.fn();

    createAffiliateInterstitialClose(setPending)();

    expect(setPending).toHaveBeenCalledWith(null);
  });

  it("renders the track CTA, buy button, and no interstitial before the first click", () => {
    const html = renderToStaticMarkup(
      createElement(DealAffiliateActions, {
        productId: "123-456",
        productName: "Tai nghe",
        clickHref: "/api/share/click?pid=123-456&s=abc",
      }),
    );

    expect(html).toContain("/auth/sign-in?action=track-product&amp;p=123-456");
    expect(html).toContain("+ Theo dõi giá miễn phí");
    expect(html).toContain("Mua ngay trên Shopee");
    expect(html).not.toContain("Bạn sắp chuyển sang Shopee");
  });
});
