import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "SaleNoti — Theo dõi giá Shopee",
  description: "Theo dõi giá Shopee. Email khi giá giảm. Affiliate đầy đủ — không tự áp coupon, không override KOC.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
