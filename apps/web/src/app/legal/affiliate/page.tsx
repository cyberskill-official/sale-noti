// FR-LEGAL-002 §1 #1 + plan §A3 — full affiliate disclosure surface with 5 principles + revenue model.
import type { Metadata } from "next";
import Link from "next/link";
import { AffiliateDisclosureCard } from "@/components/disclosure/AffiliateDisclosureCard";
import { FIVE_PRINCIPLES_VI } from "@/lib/disclosure";

export const metadata: Metadata = {
  title: "Affiliate Disclosure — SaleNoti",
  description: "Mô hình doanh thu affiliate đầy đủ của SaleNoti. 5 nguyên tắc đạo đức. Mở source revenue calculator.",
};

export const revalidate = 3600;

export default function AffiliatePage() {
  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1>Affiliate Disclosure</h1>
      <AffiliateDisclosureCard variant="card" locale="vi" />

      <h2 style={{ marginTop: 40 }}>5 nguyên tắc đạo đức (plan §A3)</h2>
      <ol>
        {FIVE_PRINCIPLES_VI.map((principle) => (
          <li key={principle.id}>
            <b>{principle.title}.</b> {principle.body}
          </li>
        ))}
      </ol>
      <p>
        Xem <Link href="/transparency">danh sách báo cáo Transparency</Link> để kiểm tra audit đạo đức hằng quý.
      </p>

      <h2 style={{ marginTop: 40 }} id="revenue-model">
        Revenue model (mở source)
      </h2>
      <pre style={{ background: "#f7fafc", padding: 16, borderRadius: 8, overflowX: "auto", fontSize: 13 }}>
        {`# Affiliate revenue per user
ARPU = (alerts_sent_per_user_per_month
        × CTR_alert        # ~25% target
        × Conversion_rate  # ~4% on Shopee
        × AOV_VND          # average order ~250K ₫
        × Commission_rate) # 1.5%–5% by category

# Example: power user
ARPU_power = 30 × 0.30 × 0.05 × 250_000 × 0.03 = ~3,400 ₫/tháng ≈ $0.14/mo

# Example: casual user
ARPU_casual = 5 × 0.20 × 0.04 × 200_000 × 0.025 = ~200 ₫/tháng ≈ $0.008/mo

# Plan §I Phase 3 scale target: MAU 100K × blended $0.5 ARPU = $50K MRR.
# Pro subscription ($1.5/mo) is the second leg; freemium 10% conversion target.`}
      </pre>

      <h2 style={{ marginTop: 40 }}>Cách kiểm chứng (audit your own numbers)</h2>
      <p>
        Mỗi affiliate link SaleNoti gửi cho bạn có 5 sub-id slots:{" "}
        <code>[salenoti, userHash, watchlistHash, source, campaign]</code>. Chúng tôi join với commission webhook của
        Shopee để tính doanh thu. Transparency Report mỗi quý cộng dồn theo từng <code>source</code> (alert_email /
        alert_push / alert_telegram / deal_page / share_deal / ext).
      </p>
      <p>
        Code mở source (sẽ public sau MVP launch):{" "}
        <a href="https://github.com/cyberskill/salenoti">github.com/cyberskill/salenoti</a>.
      </p>

      <h2 style={{ marginTop: 40 }}>Liên hệ</h2>
      <p>
        Bạn nghi ngờ chúng tôi vi phạm một trong 5 nguyên tắc? Email{" "}
        <a href="mailto:dpo@salenoti.vn">dpo@salenoti.vn</a>. Chúng tôi public-reply trong vòng 7 ngày.
      </p>

      <p style={{ marginTop: 48, fontStyle: "italic", color: "#666" }}>
        "Đây không phải là nice-to-have. Đây là moat." — Plan §A3.
      </p>
    </main>
  );
}
