// FR-GROW-002 §3 — public share-deal landing page. SSG with 5-min revalidate.
import type { Metadata } from "next";
import Link from "next/link";
import { mongo } from "@/server/db/mongo";
import { AffiliateDisclosureCard } from "@/components/disclosure/AffiliateDisclosureCard";

export const revalidate = 300; // 5 minutes per FR-GROW-002 §1 #9

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ s?: string }>;
};

async function loadProductBySlug(slug: string) {
  // Slug format expected: "<vietnamese-name>" or "i-<shopId>-<itemId>".
  const m = slug.match(/^i-(\d+)-(\d+)$/);
  if (m) {
    const p = await mongo.db("salenoti").collection("products").findOne({ shopId: Number(m[1]), itemId: Number(m[2]) });
    return p;
  }
  return mongo.db("salenoti").collection("products").findOne({ slug });
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { s } = await searchParams;
  const product = await loadProductBySlug(slug);
  if (!product) return { title: "Deal — SaleNoti" };
  const appUrl = process.env.APP_URL ?? "https://salenoti.vn";
  const title = `${product.name} — giảm ${product.currentDiscountPct ?? 0}% trên Shopee`;
  const description = `Mua giá tốt: ${new Intl.NumberFormat("vi-VN").format(product.currentPrice ?? 0)} ₫. Theo dõi giá miễn phí trên SaleNoti.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${appUrl}/deal/${slug}${s ? `?s=${s}` : ""}`,
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function DealPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { s } = await searchParams;
  const product = await loadProductBySlug(slug);

  if (!product) {
    return (
      <main style={{ maxWidth: 720, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui" }}>
        <h1>Deal không tồn tại</h1>
        <p>
          <Link href="/">← Trang chủ</Link>
        </p>
      </main>
    );
  }

  const productId = `${product.shopId}-${product.itemId}`;
  const clickHref = `/api/share/click?pid=${productId}${s ? `&s=${s}` : ""}`;

  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Home</Link>
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1fr) 2fr", gap: 16, alignItems: "start" }}>
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" style={{ width: "100%", borderRadius: 12 }} />
        ) : (
          <div style={{ background: "#f1f5f9", aspectRatio: "1/1", borderRadius: 12 }} />
        )}
        <div>
          <h1 style={{ marginTop: 0, color: "#C05621" }}>🔥 {product.name}</h1>
          <p style={{ fontSize: 24, margin: "8px 0", fontWeight: 700 }}>
            {new Intl.NumberFormat("vi-VN").format(product.currentPrice ?? 0)} ₫
            {product.currentDiscountPct ? (
              <span style={{ fontSize: 14, marginLeft: 12, color: "#666", fontWeight: 400 }}>
                — giảm {product.currentDiscountPct}% từ {new Intl.NumberFormat("vi-VN").format(product.originalPrice ?? 0)} ₫
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div style={{ margin: "24px 0" }}>
        <AffiliateDisclosureCard variant="card" />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0" }}>
        <Link
          href="/auth/sign-in?action=track-product&p=${productId}"
          style={{
            background: "#1a202c",
            color: "white",
            padding: "12px 20px",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          + Theo dõi giá miễn phí
        </Link>
        <a
          href={clickHref}
          rel="sponsored noopener"
          style={{
            background: "#FAA227",
            color: "white",
            padding: "12px 20px",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Mua ngay trên Shopee →
        </a>
      </div>

      <hr style={{ margin: "32px 0", border: "none", borderTop: "1px solid #eee" }} />

      <p style={{ fontSize: 13, color: "#666" }}>
        Nguồn giá: SaleNoti tracker · cập nhật {product.lastObservedAt ? new Date(product.lastObservedAt).toLocaleString("vi-VN") : "—"}
      </p>
      <p style={{ fontSize: 12, color: "#999" }}>
        Đây là affiliate link. <Link href="/legal/affiliate">Xem chính sách đầy đủ</Link>.
      </p>
    </main>
  );
}
