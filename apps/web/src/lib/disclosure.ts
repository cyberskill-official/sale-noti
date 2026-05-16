// FR-LEGAL-002 §1 #1 — canonical affiliate disclosure copy.
// DO NOT EDIT in place. Any wording change requires:
//   1. A new FR (FR-LEGAL-002a-...)
//   2. Bump DISCLOSURE_VERSION
//   3. Re-consent flow for existing users (FR-LEGAL-001 §1 #9)

export const DISCLOSURE_VERSION = "v1" as const;

export const AFFILIATE_DISCLOSURE_VI =
  "SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public, chúng tôi nhận hoa hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không trả thêm. Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác, ẩn deal tốt hơn để hưởng commission cao hơn.";

export const AFFILIATE_DISCLOSURE_EN =
  "SaleNoti is an affiliate price-tracker. When you click a deal in an alert or public page, we earn commission via the Shopee Affiliate Open API (1.5%–5% by category). You pay no extra. We DO NOT: auto-apply coupons, override affiliate cookies from other creators, or hide better deals to chase higher commissions.";

export type Locale = "vi" | "en";

export function disclosureFor(locale: Locale): string {
  return locale === "vi" ? AFFILIATE_DISCLOSURE_VI : AFFILIATE_DISCLOSURE_EN;
}
