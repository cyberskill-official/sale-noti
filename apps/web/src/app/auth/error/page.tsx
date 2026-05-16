// FR-AUTH-001 — error landing (used by signIn callback failures).

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; trace?: string }>;
}) {
  const { code, trace } = await searchParams;
  const messages: Record<string, string> = {
    USER_UPSERT_FAILED: "Có lỗi khi tạo tài khoản. Vui lòng thử lại sau.",
    invalid_issuer: "Token sai nguồn cung cấp.",
    invalid_audience: "Token sai đối tượng.",
    access_denied: "Bạn đã từ chối cấp quyền cho SaleNoti.",
    invalid_grant: "Mã đăng nhập đã hết hạn. Hãy thử lại.",
    clock_skew: "Giờ máy của bạn lệch nhiều so với server. Hãy đồng bộ giờ rồi thử lại.",
  };
  const msg = (code && messages[code]) ?? "Có lỗi khi đăng nhập.";
  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Lỗi đăng nhập</h1>
      <p>{msg}</p>
      {trace && <p style={{ fontSize: 11, color: "#999" }}>Trace: {trace}</p>}
      <p>
        <a href="/auth/sign-in">Thử lại</a>
      </p>
    </main>
  );
}
