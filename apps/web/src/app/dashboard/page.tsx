// FR-AUTH-001 happy-path target.
import { auth } from "@/auth";
import { sentry } from "@/server/obs/sentry.server";
import { applyTenantObservabilityTags, type TenantTier } from "@/server/obs/tenant";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  applyTenantObservabilityTags(sentry, {
    scope: "b2b",
    tenantId: session?.user?.sellerId ?? null,
    subscriptionId: (session?.user as any)?.subscriptionId ?? null,
    tier: ((session?.user as any)?.tier ?? null) as TenantTier | null,
  });

  return (
    <main style={{ maxWidth: 720, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Dashboard</h1>
      <p>
        Đăng nhập với <b>{session?.user?.email ?? "(chưa có session)"}</b>
      </p>
      <p>
        <a href="/api/auth/signout">Sign out</a>
      </p>
      <p>
        <Link href="/dashboard/coupons">Coupon aggregator</Link>
      </p>
      <p style={{ marginTop: 32, color: "#999" }}>
        FR-ADMIN-003 sẽ render coupon aggregator UI ở đây trong nhánh admin.
      </p>
    </main>
  );
}

