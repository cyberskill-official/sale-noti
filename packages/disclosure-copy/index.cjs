"use strict";

const DISCLOSURE_VERSION = "v1";

const AFFILIATE_DISCLOSURE_VI =
  "SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public, chúng tôi nhận hoa hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không trả thêm. Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác, ẩn deal tốt hơn để hưởng commission cao hơn.";

const AFFILIATE_DISCLOSURE_EN =
  "SaleNoti is an affiliate price-tracker. When you click a deal in an alert or public page, we earn commission via the Shopee Affiliate Open API (1.5%–5% by category). You pay no extra. We DO NOT: auto-apply coupons, override affiliate cookies from other creators, or hide better deals to chase higher commissions.";

const FIVE_PRINCIPLES_VI = [
  { id: 1, title: "Minh bạch", body: "Disclosure xuất hiện ở mọi surface có affiliate." },
  { id: 2, title: "Người dùng khởi tạo", body: "Affiliate link chỉ kích hoạt khi user click; không auto-redirect." },
  { id: 3, title: "Tôn trọng coupon", body: "Không auto-apply; chỉ surface known codes dạng copy-paste." },
  { id: 4, title: "Tôn trọng cookie", body: "Không override affiliate cookie của KOC/publisher khác." },
  {
    id: 5,
    title: "Không ẩn deal tốt hơn",
    body: "Ranking dùng signals khách quan, không bao giờ dùng commission rate.",
  },
];

const FIVE_PRINCIPLES_EN = [
  { id: 1, title: "Transparency", body: "Disclosure appears on every affiliate surface." },
  { id: 2, title: "User initiated", body: "Affiliate links activate only on explicit user click; no auto-redirects." },
  { id: 3, title: "Coupon respect", body: "No auto-application; known codes are copy-paste only." },
  { id: 4, title: "Cookie respect", body: "Do not override affiliate cookies from other creators." },
  { id: 5, title: "No hiding better deals", body: "Ranking uses user-value signals, never internal commission rate." },
];

module.exports = {
  DISCLOSURE_VERSION,
  AFFILIATE_DISCLOSURE_VI,
  AFFILIATE_DISCLOSURE_EN,
  FIVE_PRINCIPLES_VI,
  FIVE_PRINCIPLES_EN,
};
