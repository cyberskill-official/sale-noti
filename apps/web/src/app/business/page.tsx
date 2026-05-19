// FR-ADMIN-001 §1 #1 — public B2B landing with lead form. SSG.
import type { Metadata } from "next";
import { AffiliateDisclosureCard } from "@/components/disclosure/AffiliateDisclosureCard";
import { B2BLeadForm } from "./B2BLeadForm";

export const metadata: Metadata = {
  title: "SaleNoti for Business — Price Intelligence cho Shopee Mall/Brand",
  description: "Bán dashboard giá lịch sử + competitor tracking cho Shopee Mall và Brand sellers. From 10M₫/month.",
};

export const revalidate = 3600;

export default function BusinessPage() {
  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <h1 style={{ color: "#C05621" }}>SaleNoti for Business</h1>
      <p style={{ fontSize: 18 }}>
        Price Intelligence cho Shopee Mall / Brand sellers — historical pricing, competitor tracking, deal-monitoring
        API.
      </p>

      <h2>Bạn nhận được gì</h2>
      <ul>
        <li>Lịch sử giá đầy đủ 24 tháng cho sản phẩm bạn theo dõi (đối thủ + của chính bạn).</li>
        <li>Alert API khi đối thủ giảm giá đột ngột (latency &lt; 1 giờ).</li>
        <li>Dashboard so sánh % thay đổi giá theo ngành hàng / category.</li>
        <li>Data export CSV / Parquet để feed pipeline pricing của bạn.</li>
      </ul>

      <h2>Pricing</h2>
      <p style={{ background: "#FFFAF0", padding: 16, borderRadius: 8, border: "1px solid #FBD38D" }}>
        <b>From 10M ₫/month</b> — custom theo volume + region. Trial 30 ngày sau khi tham gia chương trình khách hàng
        đầu tiên.
      </p>

      <h2 style={{ marginTop: 32 }}>Liên hệ</h2>
      <B2BLeadForm />

      <hr style={{ margin: "48px 0", border: "none", borderTop: "1px solid #eee" }} />
      <AffiliateDisclosureCard variant="footer" />
      <p style={{ fontSize: 11, color: "#666" }}>B2B data licensing là rev stream riêng biệt — không xung đột.</p>
    </main>
  );
}
