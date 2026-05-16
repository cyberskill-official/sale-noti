export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>SaleNoti</h1>
      <p>Theo dõi giá Shopee. Email khi giá giảm.</p>
      <p>
        <a href="/auth/sign-in">Sign in</a>
        {" · "}
        <a href="/dashboard">Dashboard</a>
      </p>
      <hr />
      <p style={{ fontSize: 12, color: "#666" }}>
        SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public, chúng tôi nhận hoa
        hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không trả thêm. Chúng tôi KHÔNG: tự áp coupon,
        override cookie affiliate của KOC/publisher khác, ẩn deal tốt hơn để hưởng commission cao hơn.
      </p>
    </main>
  );
}
