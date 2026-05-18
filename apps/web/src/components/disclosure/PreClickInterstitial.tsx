// FR-LEGAL-002 §1 #6 — pre-click interstitial. Once per session (cookie-tracked 30d).
"use client";
import React from "react";
import { useEffect, useState } from "react";
import { AffiliateDisclosureCard } from "./AffiliateDisclosureCard";

export const PRE_CLICK_COOKIE_NAME = "salenoti.pre_click_v1";
export const PRE_CLICK_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30d

export function hasPreClickAcknowledgement(cookieHeader?: string): boolean {
  const value = cookieHeader ?? (typeof document === "undefined" ? "" : document.cookie);
  return value.split(";").some((c) => c.trim().startsWith(`${PRE_CLICK_COOKIE_NAME}=1`));
}

export function buildPreClickAcknowledgementCookie(): string {
  return `${PRE_CLICK_COOKIE_NAME}=1; Path=/; Max-Age=${PRE_CLICK_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function writePreClickAcknowledgement(target: Pick<Document, "cookie"> = document) {
  target.cookie = buildPreClickAcknowledgementCookie();
}

export function openAffiliateTarget(url: string, opener: typeof window.open = window.open) {
  opener(url, "_blank", "noopener,noreferrer");
}

export function affiliateDestinationHostname(url: string): string {
  try {
    return new URL(url).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

export function continueAffiliateClick(
  pending: { url: string; productName: string },
  onClose: () => void,
  deps: { document?: Pick<Document, "cookie">; opener?: typeof window.open } = {},
) {
  writePreClickAcknowledgement(deps.document);
  openAffiliateTarget(pending.url, deps.opener);
  onClose();
}

/**
 * Use this hook around every affiliate-link click handler.
 * The hook is the ONLY public surface that should kick off an affiliate deeplink click on the client.
 * FR-LEGAL-002 §1 #7 — compile-time-ish enforcement of the disclosure-first rule.
 */
export function useDeeplinkWithInterstitial() {
  const [pending, setPending] = useState<null | { url: string; productName: string }>(null);

  function open(url: string, productName: string) {
    if (hasPreClickAcknowledgement()) {
      openAffiliateTarget(url);
      return;
    }
    setPending({ url, productName });
  }

  return { open, pending, setPending };
}

export function PreClickInterstitial({
  pending,
  onClose,
}: {
  pending: { url: string; productName: string } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (pending) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aff-interstitial-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
      }}
    >
      <div style={{ background: "white", maxWidth: 480, padding: 24, borderRadius: 12 }}>
        <h2 id="aff-interstitial-title" style={{ marginTop: 0 }}>
          Bạn sắp chuyển sang Shopee
        </h2>
        <AffiliateDisclosureCard variant="card" />
        <p style={{ margin: "12px 0", fontSize: 14 }}>
          Sản phẩm: <b>{pending.productName}</b>
        </p>
        <p data-testid="aff-destination-hostname" style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>
          Đích đến: {affiliateDestinationHostname(pending.url)}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => {
              continueAffiliateClick(pending, onClose);
            }}
            style={{ background: "#FAA227", color: "white", border: 0, padding: "10px 16px", borderRadius: 8, fontWeight: 600 }}
          >
            Continue to Shopee →
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "white", color: "#333", border: "1px solid #ccc", padding: "10px 16px", borderRadius: 8 }}
          >
            Hủy
          </button>
        </div>
      </div>
    </div>
  );
}
