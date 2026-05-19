// FR-AUTH-002 §1 #10 + FR-LEGAL-002 §1 #4 — magic-link email template with disclosure footer.
// Plain React + HTML string (we render manually; React Email lib lands when more templates exist).
import { AFFILIATE_DISCLOSURE_VI } from "@/lib/disclosure";

export const MAGIC_LINK_DISCLOSURE_VI =
  "SaleNoti là price-tracker affiliate dùng Shopee Affiliate Open API. Khi bạn click vào deal trong alert, chúng tôi nhận hoa hồng. Bạn không trả thêm.";

export function renderMagicLinkEmail(args: { url: string; email: string }): { html: string; text: string } {
  const safeUrl = args.url;
  const html = `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:24px auto;padding:0 16px">
  <h2 style="margin:0 0 8px">Đăng nhập SaleNoti</h2>
  <p>Nhấn vào nút bên dưới để đăng nhập (link hết hạn sau 15 phút):</p>
  <p style="margin:24px 0">
    <a href="${safeUrl}" style="display:inline-block;background:#FAA227;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Đăng nhập SaleNoti</a>
  </p>
  <p style="font-size:13px;color:#666">Nếu bạn không yêu cầu link này, có thể bỏ qua email — link sẽ tự hết hạn.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
  <p style="font-size:11px;color:#666;line-height:1.5;margin:0 0 8px">
    ${MAGIC_LINK_DISCLOSURE_VI}
  </p>
  <p style="font-size:11px;color:#666;line-height:1.5;margin:0 0 8px">
    ${AFFILIATE_DISCLOSURE_VI}
  </p>
  <p style="font-size:11px;color:#999;margin:0">
    DPO: <a href="mailto:legal@salenoti.vn" style="color:#666">legal@salenoti.vn</a> · CyberSkill JSC · 1st Floor 207A Nguyen Van Thu, Tan Dinh, HCMC.
  </p>
</body>
</html>`;
  const text = [
    "Đăng nhập SaleNoti",
    "",
    "Nhấn vào link bên dưới để đăng nhập (link hết hạn sau 15 phút):",
    safeUrl,
    "",
    "Nếu bạn không yêu cầu link này, có thể bỏ qua email.",
    "",
    "---",
    MAGIC_LINK_DISCLOSURE_VI,
    "",
    AFFILIATE_DISCLOSURE_VI,
    "DPO: legal@salenoti.vn · CyberSkill JSC.",
  ].join("\n");
  return { html, text };
}
