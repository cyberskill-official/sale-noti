import { AffiliateDisclosureCard } from "@/components/disclosure/AffiliateDisclosureCard";

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
      <AffiliateDisclosureCard variant="footer" />
    </main>
  );
}
