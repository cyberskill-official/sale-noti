// FR-AUTH-001 — sign-in page (Google primary; magic-link comes with FR-AUTH-002).
import { signIn } from "@/auth";
import { OnboardingDisclosureStep } from "@/components/disclosure/OnboardingDisclosureStep";
import { MagicLinkForm } from "./magic-link-form";

export default function SignInPage() {
  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Đăng nhập SaleNoti</h1>
      <OnboardingDisclosureStep>
        <form action={signInWithGoogle}>
          <button type="submit">Sign in with Google</button>
        </form>
        <MagicLinkForm />
      </OnboardingDisclosureStep>
      <p style={{ fontSize: 12, marginTop: 24, color: "#666" }}>
        Bằng cách đăng nhập, bạn đồng ý với <a href="/privacy">Chính sách bảo mật</a> và quy định affiliate của chúng
        tôi. SaleNoti nhận hoa hồng từ Shopee khi bạn click vào deal — bạn không trả thêm.
      </p>
    </main>
  );
}
