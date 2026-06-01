import Link from "next/link";

import { auth } from "@/auth";
import { AFFILIATE_DISCLOSURE_VI, disclosureFor } from "@/lib/disclosure";
import { couponService, type CouponStatusFilter } from "@/server/admin/coupon.service";

export const dynamic = "force-dynamic";

type CouponSearchParams = {
  q?: string;
  status?: CouponStatusFilter;
};

function formatDate(value: string | null): string {
  if (!value) return "Không có hạn dùng";

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: CouponStatusFilter | "active" | "expired"): string {
  return status === "expired" ? "Hết hạn" : "Đang hoạt động";
}

export default async function CouponAggregatorPage({
  searchParams,
}: {
  searchParams: Promise<CouponSearchParams>;
}) {
  const session = await auth();
  const params = await searchParams;
  const result = await couponService.listCoupons({
    query: params.q,
    status: params.status ?? "active",
    limit: 24,
  });

  return (
    <main
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "3rem 1rem 4rem",
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.55,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#7c2d12", fontWeight: 700, letterSpacing: 0.4 }}>FR-ADMIN-003</p>
          <h1 style={{ margin: "0.25rem 0 0.5rem", fontSize: 40, lineHeight: 1.1 }}>Coupon aggregator</h1>
          <p style={{ margin: 0, color: "#475569" }}>
            {session?.user?.email ?? "(chưa có session)"} · Danh sách mã coupon copy-paste only, không auto-apply.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard" style={{ color: "#0f766e", textDecoration: "none", fontWeight: 600 }}>
            ← Back to dashboard
          </Link>
        </div>
      </div>

      <section
        style={{
          marginTop: 24,
          border: "1px solid #fed7aa",
          background: "linear-gradient(180deg, #fff7ed 0%, #fff 100%)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <p style={{ margin: 0, fontWeight: 700, color: "#9a3412" }}>Disclosure-first</p>
        <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{AFFILIATE_DISCLOSURE_VI}</p>
        <p style={{ margin: "8px 0 0", color: "#7c2d12", fontWeight: 600 }}>
          Chỉ sao chép mã thủ công. Không có auto-apply, không override cookie affiliate.
        </p>
      </section>

      <form
        method="get"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 220px auto",
          gap: 12,
          alignItems: "end",
          marginTop: 24,
          padding: 18,
          borderRadius: 18,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
        }}
      >
        <label style={{ display: "grid", gap: 6, fontSize: 14, color: "#334155" }}>
          Tìm coupon
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Mã, shop, nguồn..."
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #cbd5e1",
              fontSize: 15,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, fontSize: 14, color: "#334155" }}>
          Trạng thái
          <select
            name="status"
            defaultValue={params.status ?? "active"}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #cbd5e1",
              fontSize: 15,
              background: "white",
            }}
          >
            <option value="active">Đang hoạt động</option>
            <option value="expired">Hết hạn</option>
            <option value="all">Tất cả</option>
          </select>
        </label>

        <button
          type="submit"
          style={{
            padding: "12px 18px",
            borderRadius: 12,
            border: 0,
            background: "#0f766e",
            color: "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Lọc
        </button>
      </form>

      <section style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <p style={{ margin: 0, color: "#64748b" }}>
            Đang hiển thị <b>{result.items.length}</b> / <b>{result.total}</b> coupon.
          </p>
          <p style={{ margin: 0, color: "#64748b" }}>Cập nhật lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.generatedAt))}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
          {result.items.map((coupon) => (
            <article
              key={coupon.couponId}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 18,
                padding: 16,
                background: "white",
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    {coupon.sourceName}
                  </p>
                  <h2 style={{ margin: "4px 0 0", fontSize: 18, lineHeight: 1.25 }}>{coupon.title}</h2>
                </div>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    color: coupon.status === "expired" ? "#9a3412" : "#166534",
                    background: coupon.status === "expired" ? "#ffedd5" : "#dcfce7",
                  }}
                >
                  {statusLabel(coupon.status)}
                </span>
              </div>

              <p style={{ margin: "12px 0 6px", color: "#475569" }}>
                Shop: <b>{coupon.storeName}</b>
              </p>

              <div
                style={{
                  margin: "12px 0",
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: "#0f172a",
                  color: "white",
                }}
              >
                <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>Mã coupon</p>
                <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 800, letterSpacing: 0.8 }}>{coupon.code}</p>
              </div>

              <p style={{ margin: 0, color: "#334155" }}>{coupon.summary ?? "Không có mô tả thêm."}</p>

              <dl style={{ margin: "12px 0 0", display: "grid", gap: 6, fontSize: 13, color: "#475569" }}>
                <div>
                  <dt style={{ display: "inline", fontWeight: 700 }}>Hạn dùng:</dt>{" "}
                  <dd style={{ display: "inline", margin: 0 }}>{formatDate(coupon.expiresAt)}</dd>
                </div>
                <div>
                  <dt style={{ display: "inline", fontWeight: 700 }}>Nguồn:</dt>{" "}
                  <dd style={{ display: "inline", margin: 0 }}>{coupon.sourceName}</dd>
                </div>
              </dl>

              {coupon.sourceUrl ? (
                <p style={{ margin: "12px 0 0" }}>
                  <a href={coupon.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#0f766e", fontWeight: 700 }}>
                    Mở nguồn gốc coupon
                  </a>
                </p>
              ) : null}

              <p style={{ margin: "12px 0 0", color: "#9a3412", fontSize: 13, fontWeight: 600 }}>
                Copy-paste only. Không auto-apply.
              </p>
            </article>
          ))}
        </div>

        {result.items.length === 0 ? (
          <div
            style={{
              marginTop: 20,
              padding: 20,
              borderRadius: 16,
              border: "1px dashed #cbd5e1",
              background: "#f8fafc",
              color: "#475569",
            }}
          >
            Chưa có coupon nào để hiển thị. Thêm dữ liệu vào collection <code>coupon_offers</code> để aggregator có nội dung.
          </div>
        ) : null}
      </section>

      <p style={{ marginTop: 24, color: "#94a3b8", fontSize: 13 }}>
        {disclosureFor("vi")} · Tất cả coupon chỉ được sao chép thủ công.
      </p>
    </main>
  );
}
