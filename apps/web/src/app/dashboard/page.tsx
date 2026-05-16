// FR-AUTH-001 happy-path target.
import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();
  return (
    <main style={{ maxWidth: 720, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Dashboard</h1>
      <p>
        Đăng nhập với <b>{session?.user?.email ?? "(chưa có session)"}</b>
      </p>
      <p>
        <a href="/api/auth/signout">Sign out</a>
      </p>
      <p style={{ marginTop: 32, color: "#999" }}>
        FR-WATCH-001 sẽ render watchlist UI ở đây trong tuần 3–4.
      </p>
    </main>
  );
}
