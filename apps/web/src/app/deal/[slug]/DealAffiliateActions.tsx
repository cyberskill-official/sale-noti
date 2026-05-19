"use client";

import React from "react";
import Link from "next/link";
import { PreClickInterstitial, useDeeplinkWithInterstitial } from "@/components/disclosure/PreClickInterstitial";

const trackStyle: React.CSSProperties = {
  background: "#1a202c",
  color: "white",
  padding: "12px 20px",
  borderRadius: 8,
  textDecoration: "none",
  fontWeight: 600,
};

const buyStyle: React.CSSProperties = {
  background: "#FAA227",
  color: "white",
  padding: "12px 20px",
  borderRadius: 8,
  border: 0,
  textDecoration: "none",
  fontWeight: 600,
  cursor: "pointer",
};

export function buildTrackProductHref(productId: string): string {
  return `/auth/sign-in?action=track-product&p=${encodeURIComponent(productId)}`;
}

export function createAffiliateClickHandler(open: (url: string, productName: string) => void, clickHref: string, productName: string) {
  return () => open(clickHref, productName);
}

export function createAffiliateInterstitialClose(setPending: (pending: null) => void) {
  return () => setPending(null);
}

export function DealAffiliateActions({
  productId,
  productName,
  clickHref,
}: {
  productId: string;
  productName: string;
  clickHref: string;
}) {
  const { open, pending, setPending } = useDeeplinkWithInterstitial();

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0" }}>
      <Link href={buildTrackProductHref(productId)} style={trackStyle}>
        + Theo dõi giá miễn phí
      </Link>
      <button type="button" onClick={createAffiliateClickHandler(open, clickHref, productName)} style={buyStyle}>
        Mua ngay trên Shopee →
      </button>
      <PreClickInterstitial pending={pending} onClose={createAffiliateInterstitialClose(setPending)} />
    </div>
  );
}
