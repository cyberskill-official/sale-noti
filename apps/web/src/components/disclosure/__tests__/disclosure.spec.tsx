// FR-LEGAL-002 §5 — snapshot test catches drift in the canonical disclosure copy.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { renderMagicLinkEmail } from "@/server/email/templates/magic-link";
import { AFFILIATE_DISCLOSURE_VI, AFFILIATE_DISCLOSURE_EN, DISCLOSURE_VERSION, disclosureFor } from "@/lib/disclosure";
import { AffiliateDisclosureCard } from "../AffiliateDisclosureCard";
import {
  DISCLOSURE_ACK_STORAGE_KEY,
  OnboardingDisclosureStep,
  createDisclosureAcceptHandler,
  createDisclosureCheckedHandler,
  createStoredDisclosureSyncEffect,
  hasStoredDisclosureAcknowledgement,
  persistAffiliateDisclosureAcknowledgement,
} from "../OnboardingDisclosureStep";
import {
  PreClickInterstitial,
  affiliateDestinationHostname,
  buildPreClickAcknowledgementCookie,
  continueAffiliateClick,
  hasPreClickAcknowledgement,
  openAffiliateTarget,
  PRE_CLICK_COOKIE_MAX_AGE,
  PRE_CLICK_COOKIE_NAME,
  useDeeplinkWithInterstitial,
  writePreClickAcknowledgement,
} from "../PreClickInterstitial";

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

  it("returns locale-specific disclosure copy from the canonical helper", () => {
    expect(disclosureFor("vi")).toBe(AFFILIATE_DISCLOSURE_VI);
    expect(disclosureFor("en")).toBe(AFFILIATE_DISCLOSURE_EN);
  });
});

describe("FR-LEGAL-002 — disclosure UI surfaces", () => {
  it("renders card, inline, and footer variants from the canonical copy", () => {
    const card = renderToStaticMarkup(createElement(AffiliateDisclosureCard, { variant: "card", locale: "vi" }));
    const inline = renderToStaticMarkup(createElement(AffiliateDisclosureCard, { variant: "inline", locale: "en" }));
    const footer = renderToStaticMarkup(createElement(AffiliateDisclosureCard, { variant: "footer", locale: "vi" }));

    expect(card).toContain(AFFILIATE_DISCLOSURE_VI);
    expect(card).toContain(`data-version="${DISCLOSURE_VERSION}"`);
    expect(inline).toContain(AFFILIATE_DISCLOSURE_EN);
    expect(inline).toContain("/legal/affiliate");
    expect(footer).toContain('data-variant="footer"');
  });

  it("renders onboarding before children until the disclosure is accepted", () => {
    const gated = renderToStaticMarkup(createElement(OnboardingDisclosureStep, { children: createElement("span", null, "Track your first product") }));
    const accepted = renderToStaticMarkup(
      createElement(OnboardingDisclosureStep, {
        initialAccepted: true,
        children: createElement("span", null, "Track your first product"),
      }),
    );

    expect(gated).toContain("Trước khi bắt đầu");
    expect(gated).toContain(AFFILIATE_DISCLOSURE_VI);
    expect(gated).toContain("Tôi đã hiểu và đồng ý");
    expect(gated).not.toContain("Track your first product");
    expect(accepted).toContain("Track your first product");
    expect(accepted).not.toContain("Trước khi bắt đầu");
  });

  it("persists the onboarding acknowledgement locally and posts the contract payload", async () => {
    const setItem = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await persistAffiliateDisclosureAcknowledgement({ storage: { setItem }, fetcher });

    expect(setItem).toHaveBeenCalledWith(DISCLOSURE_ACK_STORAGE_KEY, "1");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/disclosure-ack",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "affiliate_disclosure_v1" }),
      }),
    );
  });

  it("keeps local acknowledgement even when durable consent POST is unavailable", async () => {
    const setItem = vi.fn();
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(persistAffiliateDisclosureAcknowledgement({ storage: { setItem }, fetcher })).resolves.toBeUndefined();

    expect(setItem).toHaveBeenCalledWith(DISCLOSURE_ACK_STORAGE_KEY, "1");
  });

  it("can run without browser storage or fetch during defensive rendering", async () => {
    vi.stubGlobal("fetch", undefined);

    await expect(persistAffiliateDisclosureAcknowledgement()).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("reads stored acknowledgement without exposing raw storage details to callers", () => {
    expect(hasStoredDisclosureAcknowledgement({ getItem: () => "1" })).toBe(true);
    expect(hasStoredDisclosureAcknowledgement({ getItem: () => null })).toBe(false);
    expect(hasStoredDisclosureAcknowledgement()).toBe(false);
  });

  it("syncs browser storage and advances after acknowledgement through testable handlers", async () => {
    const setAccepted = vi.fn();
    const setChecked = vi.fn();
    const storage = {
      getItem: vi.fn(() => "1"),
      setItem: vi.fn(),
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    createStoredDisclosureSyncEffect(setAccepted, () => storage)();
    await createDisclosureAcceptHandler(setAccepted, { storage, fetcher })();
    createDisclosureCheckedHandler(setChecked)({ target: { checked: true } });

    expect(setAccepted).toHaveBeenNthCalledWith(1, true);
    expect(setAccepted).toHaveBeenNthCalledWith(2, true);
    expect(setChecked).toHaveBeenCalledWith(true);
    expect(storage.setItem).toHaveBeenCalledWith(DISCLOSURE_ACK_STORAGE_KEY, "1");
  });

  it("uses browser defaults when storage and fetch are available globally", async () => {
    const setAccepted = vi.fn();
    const localStorage = {
      getItem: vi.fn(() => "1"),
      setItem: vi.fn(),
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("fetch", fetcher);

    createStoredDisclosureSyncEffect(setAccepted)();
    await persistAffiliateDisclosureAcknowledgement();

    expect(setAccepted).toHaveBeenCalledWith(true);
    expect(localStorage.setItem).toHaveBeenCalledWith(DISCLOSURE_ACK_STORAGE_KEY, "1");
    expect(fetcher).toHaveBeenCalledWith("/api/auth/disclosure-ack", expect.any(Object));
    vi.unstubAllGlobals();
  });
});

describe("FR-LEGAL-002 — pre-click affiliate interstitial", () => {
  it("renders nothing without a pending affiliate click", () => {
    const html = renderToStaticMarkup(createElement(PreClickInterstitial, { pending: null, onClose: vi.fn() }));
    expect(html).toBe("");
  });

  it("renders disclosure, product, and destination hostname for the pending click", () => {
    const html = renderToStaticMarkup(
      createElement(PreClickInterstitial, {
        pending: { url: "https://shopee.vn/product-i.1.2?affiliate=salenoti", productName: "Máy pha cà phê" },
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain(AFFILIATE_DISCLOSURE_VI);
    expect(html).toContain("Máy pha cà phê");
    expect(html).toContain("shopee.vn");
    expect(html).toContain("Continue to Shopee");
    expect(html).toContain("Hủy");
  });

  it("handles malformed destination URLs defensively", () => {
    expect(affiliateDestinationHostname("https://shopee.vn/product-i.1.2")).toBe("shopee.vn");
    expect(affiliateDestinationHostname("file:///tmp/local")).toBe("unknown");
    expect(affiliateDestinationHostname("not a url")).toBe("unknown");
  });

  it("tracks the 30-day pre-click cookie contract", () => {
    expect(hasPreClickAcknowledgement(`${PRE_CLICK_COOKIE_NAME}=1; other=ok`)).toBe(true);
    expect(hasPreClickAcknowledgement("other=ok")).toBe(false);
    expect(hasPreClickAcknowledgement()).toBe(false);
    expect(buildPreClickAcknowledgementCookie()).toBe(
      `${PRE_CLICK_COOKIE_NAME}=1; Path=/; Max-Age=${PRE_CLICK_COOKIE_MAX_AGE}; SameSite=Lax`,
    );
  });

  it("uses browser defaults for cookie writes and isolated window opens", () => {
    const fakeDocument = { cookie: `${PRE_CLICK_COOKIE_NAME}=1` };
    const opener = vi.fn();
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("window", { open: opener });

    expect(hasPreClickAcknowledgement()).toBe(true);
    writePreClickAcknowledgement();
    openAffiliateTarget("https://shopee.vn/default-open");

    expect(fakeDocument.cookie).toBe(buildPreClickAcknowledgementCookie());
    expect(opener).toHaveBeenCalledWith("https://shopee.vn/default-open", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("continues only after writing the acknowledgement cookie", () => {
    const fakeDocument = { cookie: "" };
    const opener = vi.fn();
    const onClose = vi.fn();

    continueAffiliateClick(
      { url: "https://shopee.vn/product-i.1.2", productName: "Deal" },
      onClose,
      { document: fakeDocument, opener },
    );

    expect(fakeDocument.cookie).toBe(buildPreClickAcknowledgementCookie());
    expect(opener).toHaveBeenCalledWith("https://shopee.vn/product-i.1.2", "_blank", "noopener,noreferrer");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens affiliate targets with noopener isolation", () => {
    const opener = vi.fn();
    openAffiliateTarget("https://shopee.vn/product-i.1.2", opener);
    expect(opener).toHaveBeenCalledWith("https://shopee.vn/product-i.1.2", "_blank", "noopener,noreferrer");
  });

  it("hook opens immediately after pre-click acknowledgement and queues otherwise", () => {
    let hook!: ReturnType<typeof useDeeplinkWithInterstitial>;
    const opener = vi.fn();
    const capture = (value: ReturnType<typeof useDeeplinkWithInterstitial>) => {
      hook = value;
    };
    function Probe() {
      capture(useDeeplinkWithInterstitial());
      return null;
    }

    vi.stubGlobal("document", { cookie: `${PRE_CLICK_COOKIE_NAME}=1` });
    vi.stubGlobal("window", { open: opener });
    renderToStaticMarkup(createElement(Probe));
    hook.open("https://shopee.vn/acked", "Acked deal");
    expect(opener).toHaveBeenCalledWith("https://shopee.vn/acked", "_blank", "noopener,noreferrer");

    vi.stubGlobal("document", { cookie: "" });
    renderToStaticMarkup(createElement(Probe));
    expect(() => hook.open("https://shopee.vn/pending", "Pending deal")).not.toThrow();
    vi.unstubAllGlobals();
  });
});
