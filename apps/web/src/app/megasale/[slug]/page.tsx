// FR-GROW-003 §1 #8 — public SEO landing per Mega Sale event.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mongo } from "@/server/db/mongo";

export const revalidate = 1800; // 30-min cache per FR-GROW-003 §1 #5

const SALES = [
  { slug: "2026-09-09", label: "9.9 Super Sale", hashtag: "9.9SaleNoti" },
  { slug: "2026-10-10", label: "10.10 Brand Day", hashtag: "10.10SaleNoti" },
  { slug: "2026-11-11", label: "11.11 Double Eleven", hashtag: "11.11SaleNoti" },
  { slug: "2026-12-12", label: "12.12 Birthday Sale", hashtag: "12.12SaleNoti" },
];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sale = SALES.find((s) => s.slug === slug);
  if (!sale) return { title: "Sale — SaleNoti" };
  return {
    title: `${sale.label} — Top deal trên Shopee | SaleNoti`,
    description: `Top 100 sản phẩm giảm sâu nhất trong ${sale.label}. Cập nhật mỗi 30 phút.`,
  };
}

export default async function MegaSalePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sale = SALES.find((s) => s.slug === slug);
  if (!sale) notFound();

  let topDeals: any[] = [];
  if (process.env.MONGODB_URI) {
    topDeals = await mongo
      .db("salenoti")
      .collection("products")
      .find({ _megaSaleOverride: slug, currentDiscountPct: { $gte: 30 } })
      .sort({ currentDiscountPct: -1, sales: -1 })
      .limit(100)
      .toArray();
  }

  return (
    <main style={{ maxWidth: 960, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1 style={{ color: "#C05621" }}>🔥 {sale.label}</h1>
      <p>Top {topDeals.length} sản phẩm giảm sâu nhất, cập nhật mỗi 30 phút. #{sale.hashtag}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginTop: 24 }}>
        {topDeals.map((p: any) => (
          <a
            key={`${p.shopId}-${p.itemId}`}
            href={`/deal/${p.slug ?? `i-${p.shopId}-${p.itemId}`}`}
            style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, textDecoration: "none", color: "inherit", display: "block" }}
          >
            {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: "100%", borderRadius: 8, aspectRatio: "1/1", objectFit: "cover" }} /> : null}
            <p style={{ fontSize: 13, fontWeight: 600, marginTop: 8, margin: "8px 0 4px" }}>{p.name}</p>
            <p style={{ fontSize: 14, color: "#C05621", margin: 0, fontWeight: 700 }}>
              {new Intl.NumberFormat("vi-VN").format(p.currentPrice ?? 0)} ₫
              <span style={{ fontSize: 12, color: "#666", marginLeft: 6, fontWeight: 400 }}>(-{p.currentDiscountPct}%)</span>
            </p>
          </a>
        ))}
        {topDeals.length === 0 ? <p>Đang tổng hợp deals. Quay lại sau 30 phút.</p> : null}
      </div>
    </main>
  );
}
