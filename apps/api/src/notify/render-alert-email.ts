// FR-NOTIF-001 §1 #4 — alert email template (HTML + plaintext fallback).
// Disclosure paragraph (FR-LEGAL-002 §1 #4) is locked in the footer.
import { AFFILIATE_DISCLOSURE_VI } from "@salenoti/disclosure-copy";

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
  const subject = truncateSubject(`🔥 ${input.productName} giảm ${input.currentDiscountPct}% — ${formatVnd(input.currentPrice)}`);
  const safeProduct = escapeHtml(input.productName);
  const safeImage = input.imageUrl ? escapeAttr(input.imageUrl) : null;
  const safeCta = escapeAttr(input.ctaUrl);
  const safeUnsub = escapeAttr(input.unsubscribeUrl);

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f6f7f9">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px;background:#ffffff">
          <tr><td style="padding:20px">
            ${safeImage ? `<img src="${safeImage}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:12px">` : ""}
            <h2 style="margin:0 0 4px;color:#C05621;font-size:22px;line-height:1.25">🔥 ${safeProduct}</h2>
            <p style="margin:0 0 4px;font-size:18px"><b>${formatVnd(input.currentPrice)}</b> <span style="color:#666">— giảm ${input.currentDiscountPct}% từ ${formatVnd(input.originalPrice)}</span></p>
            <p style="margin:0 0 8px;color:#666;font-size:13px">Baseline: ${formatVnd(input.baselineAtTrack)}</p>
            ${input.last30dMin !== null ? `<p style="margin:0 0 16px;color:#666;font-size:13px">Min 30 ngày: ${formatVnd(input.last30dMin)}</p>` : ""}
            <p style="margin:24px 0">
              <a href="${safeCta}" style="display:inline-block;background:#FAA227;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Mua ngay trên Shopee →</a>
            </p>
            <p style="font-size:12px;color:#999;margin:8px 0 24px">Trigger: ${escapeHtml(input.triggerKind)}</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:11px;color:#666;line-height:1.5">${AFFILIATE_DISCLOSURE_VI}</p>
            <p style="font-size:11px;color:#999;margin-top:12px">
              <a href="${safeUnsub}" style="color:#666">Tắt alert cho sản phẩm này</a>
              · DPO: <a href="mailto:legal@salenoti.vn" style="color:#666">legal@salenoti.vn</a>
              · CyberSkill JSC · 1st Floor 207A Nguyen Van Thu, Tan Dinh, HCMC.
            </p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
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
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function truncateSubject(s: string): string {
  return s.length > 78 ? `${s.slice(0, 75)}...` : s;
}
