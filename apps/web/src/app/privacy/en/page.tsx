import type { Metadata } from "next";
import Link from "next/link";
import { AFFILIATE_DISCLOSURE_EN } from "@/lib/disclosure";

export const metadata: Metadata = {
  title: "Privacy Policy — SaleNoti",
  description: "English translation of the SaleNoti Privacy Policy under Vietnam Decree 13/2023/ND-CP.",
  alternates: { languages: { vi: "/privacy", en: "/privacy/en" } },
};

export const revalidate = 3600;

export default function PrivacyEnPage() {
  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Home</Link> · <Link href="/privacy">Tiếng Việt</Link>
      </p>
      <h1>Privacy Policy — SaleNoti</h1>
      <p style={{ color: "#666" }}>Version v1.0.0 — effective after A05 acknowledges DPIA filing.</p>
      <p>
        The Vietnamese version at <Link href="/privacy">/privacy</Link> is authoritative. This English version is a
        convenience translation.
      </p>

      <h2>1. One-minute summary</h2>
      <ul>
        <li>SaleNoti tracks Shopee Vietnam prices and sends email, web push, or Telegram alerts.</li>
        <li>{AFFILIATE_DISCLOSURE_EN}</li>
        <li>SaleNoti does not sell personal data.</li>
      </ul>

      <h2>2. What we collect</h2>
      <p>
        Email, display name, Google OAuth ID, tracked product URLs, alert settings, notification history, truncated IP,
        user agent, optional push subscription, optional Telegram chat ID, and payment provider IDs when you subscribe.
      </p>

      <h2>3. Lawful basis and retention</h2>
      <p>
        Consent, contract performance, and legitimate interest under Decree 13. Notification logs are retained 365 days;
        browser-extension logs 90 days; billing skeleton records up to 7 years with PII nulled after erasure.
      </p>

      <h2>4. Cross-border transfers</h2>
      <p>
        Recipients include MongoDB Atlas Singapore, Vercel US edge, Resend US, PostHog US, Sentry US, Better Stack,
        Shopee Affiliate, Telegram, Stripe, VNPay, MoMo, and Neon Singapore. Details are published in the{" "}
        <Link href="/legal/cross-border-transfer-impact-assessment">cross-border transfer assessment</Link>.
      </p>

      <h2>5. Your rights</h2>
      <ul>
        <li>Access request: structured JSON within the statutory window.</li>
        <li>Data export: ZIP delivery within 30 days.</li>
        <li>Delete account: immediate soft-tombstone, 24-hour cancellation window, hard purge after 72 hours.</li>
        <li>Restriction, objection, portability, and complaint rights through the DPO.</li>
      </ul>

      <h2>6. Incidents</h2>
      <p>
        Breach signals page the DPO and start the 72-hour A05 notification clock. The breach template is prepared before
        production data collection.
      </p>

      <hr style={{ margin: "48px 0", border: "none", borderTop: "1px solid #eee" }} />
      <p style={{ fontSize: 13, color: "#666" }}>
        DPO: <a href="mailto:legal@salenoti.vn">legal@salenoti.vn</a> · (+84) 906 878 091
      </p>
    </main>
  );
}
