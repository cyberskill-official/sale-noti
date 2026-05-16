// FR-LEGAL-001 §1 #3 — Privacy Policy public surface.
// Renders the canonical Vietnamese policy with an English toggle. SSG/ISR.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Chính sách bảo mật — SaleNoti",
  description:
    "Chính sách bảo mật SaleNoti theo Nghị định 13/2023/NĐ-CP. DPO: legal@salenoti.vn.",
  alternates: { languages: { vi: "/privacy", en: "/privacy?lang=en" } },
};

export const revalidate = 3600;

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  const en = lang === "en";
  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Home</Link> · {en ? <Link href="/privacy">Tiếng Việt</Link> : <Link href="/privacy?lang=en">English</Link>}
      </p>
      <h1>{en ? "Privacy Policy — SaleNoti" : "Chính sách bảo mật — SaleNoti"}</h1>
      <p style={{ color: "#666" }}>
        {en ? "Version v1.0.0 — effective after A05 acknowledges DPIA filing." : "Phiên bản v1.0.0 — hiệu lực sau khi A05 tiếp nhận DPIA."}
      </p>

      {en ? <PrivacyEn /> : <PrivacyVi />}

      <hr style={{ margin: "48px 0", border: "none", borderTop: "1px solid #eee" }} />
      <p style={{ fontSize: 13, color: "#666" }}>
        {en ? "DPO contact:" : "Liên hệ DPO:"}{" "}
        <a href="mailto:legal@salenoti.vn">legal@salenoti.vn</a> · (+84) 906 878 091
      </p>
      <p style={{ fontSize: 13, color: "#666" }}>
        CyberSkill JSC · 1st Floor, 207A Nguyen Van Thu Street, Tan Dinh Ward, Ho Chi Minh City, Vietnam · DUNS 673219568
      </p>
    </main>
  );
}

/* Concise summaries linking to the authoritative markdown in docs/legal/.
 * Source-of-truth files:
 *   docs/legal/privacy-policy-vi.md (authoritative)
 *   docs/legal/privacy-policy-en.md (translation)
 */
function PrivacyVi() {
  return (
    <section>
      <h2>1. Tóm tắt một phút</h2>
      <ul>
        <li>SaleNoti theo dõi giá Shopee Việt Nam. Email/push/Telegram khi giá giảm theo trigger bạn cài.</li>
        <li>Chúng tôi nhận hoa hồng 1.5–5% qua Shopee Affiliate Open API khi bạn click vào deal. Bạn không trả thêm.</li>
        <li>Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC khác, ẩn deal tốt hơn để hưởng commission cao hơn, bán dữ liệu cá nhân.</li>
        <li>Bạn có quyền truy cập, sửa, xóa, hạn chế, di chuyển dữ liệu (Điều 14–22 NĐ 13).</li>
      </ul>

      <h2>2. Dữ liệu chúng tôi thu thập</h2>
      <p>Email, tên hiển thị, OAuth ID Google (nếu dùng), URL sản phẩm bạn theo dõi, cấu hình alert, lịch sử notification, IP truncated (/24), User-Agent, Push subscription nếu bạn opt-in, Telegram chat ID nếu bạn opt-in, Stripe/VNPay/MoMo customer ID nếu Pro.</p>
      <p>Chúng tôi KHÔNG thu thập: địa chỉ nhà, CCCD, ngày sinh, thông tin sức khỏe, sinh trắc, vị trí GPS, lịch sử duyệt web ngoài Shopee, Drive/Calendar/Photos của Google.</p>

      <h2>3. Cơ sở pháp lý & thời gian lưu</h2>
      <p>Sự đồng ý + thực hiện hợp đồng + lợi ích hợp pháp (Điều 17 NĐ 13). Notification logs 365 ngày, IP/UA 90–365 ngày, push subscription đến khi bạn revoke, payment ID 7 năm (yêu cầu thuế).</p>

      <h2>4. Bên thứ ba nhận dữ liệu</h2>
      <p>
        MongoDB Atlas (Singapore), Vercel (US edge), Railway (US), Resend (US), PostHog (US — PII đã hash),
        Sentry (US — email đã redact), Better Stack (EU, không PII), Shopee Affiliate (Singapore — không PII outbound),
        Telegram (UAE, chỉ khi opt-in), Stripe (US/Ireland), VNPay (VN), MoMo (VN).
      </p>
      <p>
        Chi tiết tại{" "}
        <a href="/legal/cross-border-transfer-impact-assessment">đánh giá tác động chuyển dữ liệu ra nước ngoài</a> (Điều 25 NĐ 13).
      </p>

      <h2>5. Quyền của bạn</h2>
      <ul>
        <li>Xuất dữ liệu: bấm "Export my data" trong dashboard (ZIP file trong 30 ngày).</li>
        <li>Xóa tài khoản: bấm "Delete account" — soft-delete 24 giờ, hard-purge 72 giờ.</li>
        <li>Hạn chế / phản đối / di chuyển: email DPO.</li>
        <li>Khiếu nại: A05 / Bộ Công an.</li>
      </ul>

      <h2>6. Bảo mật & sự cố</h2>
      <p>TLS 1.2+ mọi nơi · AES-256 encryption-at-rest · Auth.js v5 + JWT rotation + reuse-detection · breach-detector tự động thông báo founder + A05 trong 72 giờ.</p>

      <h2>7. Cookie</h2>
      <ul>
        <li><code>salenoti.session-token</code> — phiên đăng nhập 15 phút (HTTP-only, Secure).</li>
        <li><code>salenoti.refresh-token</code> — refresh 30 ngày (HTTP-only, Path-scoped).</li>
        <li><code>salenoti.pre_click_v1</code> — đánh dấu đã xem disclosure (30 ngày).</li>
        <li><code>salenoti.ref</code> — referral cookie (30 ngày).</li>
      </ul>

      <h2>8. Trẻ vị thành niên</h2>
      <p>Không hướng đến người dưới 18 tuổi. Nếu chúng tôi biết một tài khoản thuộc người dưới 18, chúng tôi xóa trong 24 giờ.</p>

      <h2>9. Sửa đổi</h2>
      <p>Khi sửa đổi quan trọng, chúng tôi gửi email trước 7 ngày + yêu cầu re-consent qua checkbox. Trường <code>policyVersion</code> trong <code>users.consents</code> ghi lại phiên bản bạn đồng ý.</p>
    </section>
  );
}

function PrivacyEn() {
  return (
    <section>
      <p>
        Authoritative version is Vietnamese; this is a convenience translation. Full text at{" "}
        <a href="https://github.com/cyberskill/salenoti/blob/main/docs/legal/privacy-policy-en.md">docs/legal/privacy-policy-en.md</a>.
      </p>

      <h2>1. One-minute summary</h2>
      <ul>
        <li>SaleNoti tracks Shopee Vietnam prices. We email/push/Telegram you when prices drop per your triggers.</li>
        <li>We earn 1.5–5% commission via the Shopee Affiliate Open API when you click a deal. You pay no extra.</li>
        <li>We DO NOT auto-apply coupons, override other publishers' affiliate cookies, hide better deals, or sell your personal data.</li>
        <li>You have rights to access, correct, erase, restrict, port your data (Articles 14–22 Decree 13).</li>
      </ul>

      <h2>2. What we collect</h2>
      <p>Email, display name, Google OAuth ID (if used), tracked product URLs, alert config, notification history, truncated IP (/24), User-Agent, optional push subscription, optional Telegram chat ID, optional Stripe/VNPay/MoMo customer ID.</p>
      <p>We do not collect home address, DOB, government ID, health data, biometrics, GPS, browsing history outside Shopee, Drive/Calendar/Photos.</p>

      <h2>3. Lawful basis & retention</h2>
      <p>Consent + contract performance + legitimate interest (Art. 17 Decree 13). Notification logs 365d, IP/UA 90–365d, push subscription until you revoke, payment ID 7y (tax requirement).</p>

      <h2>4. Third-party recipients</h2>
      <p>Same recipients as Vietnamese version §4 — see <a href="/legal/cross-border-transfer-impact-assessment">cross-border transfer assessment</a>.</p>

      <h2>5. Your rights</h2>
      <ul>
        <li>Data export: "Export my data" in dashboard, ZIP delivered within 30d.</li>
        <li>Delete account: soft-delete in 24h, hard-purge in 72h.</li>
        <li>Restrict / object / port: email the DPO.</li>
        <li>Complaint: A05 / Ministry of Public Security.</li>
      </ul>

      <h2>6. Security & incidents</h2>
      <p>TLS 1.2+ everywhere · AES-256 at rest · Auth.js v5 + JWT rotation + reuse-detection · breach detector auto-notifies founder and A05 within 72 hours.</p>

      <h2>7. Cookies & changes</h2>
      <p>Same set as Vietnamese version §7–§9.</p>
    </section>
  );
}
