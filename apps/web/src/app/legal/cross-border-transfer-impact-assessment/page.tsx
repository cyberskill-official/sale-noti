// Companion public page referenced from /privacy. Summarises the assessment + links the markdown source.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cross-border Transfer Impact Assessment — SaleNoti",
  description:
    "Đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài theo Điều 25 Nghị định 13/2023/NĐ-CP.",
};

export const revalidate = 3600;

export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/privacy">← Privacy Policy</Link>
      </p>
      <h1>Cross-border Transfer Impact Assessment</h1>
      <p style={{ color: "#666" }}>Per Article 25, Decree 13/2023/NĐ-CP. Companion to the DPIA filed with A05.</p>

      <p>
        Some processors host outside Vietnam. The lawful basis is (a) explicit user consent recorded in your{" "}
        <code>users.consents</code> entry at sign-up, AND (b) each processor maintains certification adequate to PDPL
        standards (SOC 2 Type II / ISO 27001 / GDPR-aligned).
      </p>

      <h2>Recipients</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 16 }}>
        <thead>
          <tr style={{ background: "#f7fafc", textAlign: "left" }}>
            <th style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}>Vendor</th>
            <th style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}>Country</th>
            <th style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}>Adequacy basis</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["MongoDB Atlas", "Singapore", "SOC 2 Type II + DPA"],
            ["Vercel", "USA (edge)", "SOC 2 Type II + DPA"],
            ["Railway", "USA", "SOC 2 (in progress) + DPA"],
            ["Resend", "USA", "SOC 2 Type II + DPA"],
            ["PostHog", "USA", "SOC 2 Type II + hashed PII"],
            ["Sentry", "USA", "SOC 2 Type II + beforeSend redaction"],
            ["Better Stack", "EU (Czech Republic)", "GDPR-aligned · no PII"],
            ["Shopee Affiliate API", "Singapore", "Shopee VN ToS · no PII outbound"],
            ["Stripe", "USA / Ireland", "PCI DSS L1 · SOC 1/2 · ISO 27001"],
            ["VNPay", "Vietnam (domestic)", "Decree 13 applies directly"],
            ["MoMo", "Vietnam (domestic)", "Decree 13 applies directly"],
            ["Telegram", "UAE", "User-initiated opt-in"],
          ].map(([v, c, a]) => (
            <tr key={v}>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{v}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{c}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{a}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 32 }}>Quarterly audit</h2>
      <p>
        The DPO re-checks each row above quarterly: certification still valid, hosting region unchanged, no new
        sub-processor that materially affects our data flow, DPA URL still current.
      </p>

      <h2>Migration plan</h2>
      <p>
        If a recipient loses adequacy basis, we migrate within 90 days. Alternates documented in the full markdown at{" "}
        <a href="https://github.com/cyberskill/salenoti/blob/main/docs/legal/cross-border-transfer-impact-assessment.md">
          cross-border-transfer-impact-assessment.md §3.2
        </a>{" "}
        (open-source after MVP launch).
      </p>

      <p style={{ marginTop: 32, fontSize: 13, color: "#666" }}>
        DPO sign-off: Stephen Cheng · legal@salenoti.vn · last reviewed 2026-05-XX.
      </p>
    </main>
  );
}
