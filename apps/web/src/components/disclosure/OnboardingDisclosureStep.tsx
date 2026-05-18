"use client";

import React from "react";
import { useEffect, useState } from "react";
import { AFFILIATE_DISCLOSURE_VI, DISCLOSURE_VERSION, FIVE_PRINCIPLES_VI } from "@/lib/disclosure";

export const DISCLOSURE_ACK_STORAGE_KEY = `salenoti.${DISCLOSURE_VERSION}.affiliateDisclosureAccepted`;

export function hasStoredDisclosureAcknowledgement(storage?: Pick<Storage, "getItem">): boolean {
  return storage?.getItem(DISCLOSURE_ACK_STORAGE_KEY) === "1";
}

export async function persistAffiliateDisclosureAcknowledgement({
  storage,
  fetcher,
}: {
  storage?: Pick<Storage, "setItem">;
  fetcher?: typeof fetch;
} = {}) {
  const targetStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  targetStorage?.setItem(DISCLOSURE_ACK_STORAGE_KEY, "1");

  const post = fetcher ?? (typeof fetch === "undefined" ? undefined : fetch);
  if (!post) return;

  await post("/api/auth/disclosure-ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: `affiliate_disclosure_${DISCLOSURE_VERSION}` }),
  }).catch(() => {
    // Anonymous users record durable consent on the sign-in callback.
  });
}

export function createStoredDisclosureSyncEffect(
  setAccepted: (accepted: boolean) => void,
  storageProvider: () => Pick<Storage, "getItem"> = () => window.localStorage,
) {
  return () => {
    setAccepted(hasStoredDisclosureAcknowledgement(storageProvider()));
  };
}

export function createDisclosureAcceptHandler(
  setAccepted: (accepted: boolean) => void,
  deps?: Parameters<typeof persistAffiliateDisclosureAcknowledgement>[0],
) {
  return async () => {
    await persistAffiliateDisclosureAcknowledgement(deps);
    setAccepted(true);
  };
}

export function createDisclosureCheckedHandler(setChecked: (checked: boolean) => void) {
  return (event: { target: { checked: boolean } }) => {
    setChecked(event.target.checked);
  };
}

export function OnboardingDisclosureStep({
  children,
  initialAccepted = false,
}: {
  children: React.ReactNode;
  initialAccepted?: boolean;
}) {
  const [accepted, setAccepted] = useState(initialAccepted);
  const [checked, setChecked] = useState(false);

  useEffect(createStoredDisclosureSyncEffect(setAccepted), []);

  if (accepted) return <>{children}</>;

  return (
    <section
      data-testid="onboarding-disclosure-step"
      style={{ border: "1px solid #FBD38D", background: "#FFFAF0", borderRadius: 8, padding: 16, marginTop: 24 }}
    >
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Trước khi bắt đầu</h2>
      <p style={{ fontSize: 13, lineHeight: 1.5 }}>{AFFILIATE_DISCLOSURE_VI}</p>
      <ol style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 20 }}>
        {FIVE_PRINCIPLES_VI.map((principle) => (
          <li key={principle.id}>
            <b>{principle.title}:</b> {principle.body}
          </li>
        ))}
      </ol>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={checked} onChange={createDisclosureCheckedHandler(setChecked)} />
        Tôi đã hiểu và đồng ý
      </label>
      <button
        type="button"
        disabled={!checked}
        onClick={createDisclosureAcceptHandler(setAccepted)}
        style={{ marginTop: 12, padding: "10px 14px" }}
      >
        Tiếp tục
      </button>
    </section>
  );
}
