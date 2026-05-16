// FR-NOTIF-001 §1 #4 — alert email template (HTML + plaintext fallback).
// Disclosure paragraph (FR-LEGAL-002 §1 #4) is locked in the footer.

const AFFILIATE_DISCLOSURE_VI =
  "SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public, chúng tôi nhận hoa hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không trả thêm. Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác, ẩn deal tốt hơn để hưởng commission cao hơn.";

function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n) + " ₫";
}

export type AlertEmailInput = {
  productName: string;
  imageUrl: string | null;
  currentPrice: number;
  originalPrice: number;
  currentDiscountPct: number;
  last30dMin: number | null;
  baselineAtTrack: number;
  triggerKind: string;
  ctaUrl: string;
  unsubscribeUrl: string;
};

export function renderAlertEmail(input: AlertEmailInput): { subject: string; html: string; text: string } {
  const subject = `🔥 ${input.productName} giảm ${input.currentDiscountPct}% — ${formatVnd(input.currentPrice)}`;

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:24px auto;padding:0 16px">
  ${input.imageUrl ? `<img src="${input.imageUrl}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:12px">` : ""}
  <h2 style="margin:0 0 4px;color:#C05621">🔥 ${escapeHtml(input.productName)}</h2>
  <p style="margin:0 0 4px;font-size:18px"><b>${formatVnd(input.currentPrice)}</b> <span style="color:#666">— giảm ${input.currentDiscountPct}% từ ${formatVnd(input.originalPrice)}</span></p>
  ${input.last30dMin !== null ? `<p style="margin:0 0 16px;color:#666;font-size:13px">Min 30 ngày: ${formatVnd(input.last30dMin)}</p>` : ""}
  <p style="margin:24px 0">
    <a href="${input.ctaUrl}" style="display:inline-block;background:#FAA227;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Mua ngay trên Shopee →</a>
  </p>
  <p style="font-size:12px;color:#999;margin:8px 0 24px">Trigger: ${input.triggerKind}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:11px;color:#666;line-height:1.5">${AFFILIATE_DISCLOSURE_VI}</p>
  <p style="font-size:11px;color:#999;margin-top:12px">
    <a href="${input.unsubscribeUrl}" style="color:#666">Tắt alert cho sản phẩm này</a>
    · DPO: <a href="mailto:legal@salenoti.vn" style="color:#666">legal@salenoti.vn</a>
    · CyberSkill JSC · 1st Floor 207A Nguyen Van Thu, Tan Dinh, HCMC.
  </p>
</body></html>`;

  const text = [
    `🔥 ${input.productName}`,
    `${formatVnd(input.currentPrice)} — giảm ${input.currentDiscountPct}% từ ${formatVnd(input.originalPrice)}`,
    input.last30dMin !== null ? `Min 30 ngày: ${formatVnd(input.last30dMin)}` : "",
    "",
    `Mua ngay: ${input.ctaUrl}`,
    `Trigger: ${input.triggerKind}`,
    "",
    "---",
    AFFILIATE_DISCLOSURE_VI,
    `Tắt alert: ${input.unsubscribeUrl}`,
    "DPO: legal@salenoti.vn · CyberSkill JSC",
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
