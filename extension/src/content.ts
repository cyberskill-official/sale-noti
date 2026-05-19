// FR-EXT-001 §6 — full content script.
// Injects "+ Theo dõi giá" button on shopee.vn product pages, gated by disclosure ack.
// Detects existing publisher affiliate cookies and forwards respect_other_publisher to backend.

const SHOPEE_AFFILIATE_COOKIE_RE = /^(AFFILIATE_REF|sht|aff_ref|aff_sub)/i;
const PRODUCT_URL_RE = /-i\.(\d+)\.(\d+)/;

(async () => {
  // FR-EXT-001 §1 #8 — gate by disclosure ack.
  const { disclosureAcknowledgedAt } = await chrome.storage.local.get("disclosureAcknowledgedAt");
  if (!disclosureAcknowledgedAt) {
    showDisclosureRequired();
    return;
  }

  const match = location.pathname.match(PRODUCT_URL_RE);
  if (!match) return;

  if (document.getElementById("salenoti-track-btn")) return; // idempotent

  const button = document.createElement("button");
  button.id = "salenoti-track-btn";
  button.textContent = "+ Theo dõi giá";
  button.setAttribute("data-salenoti-version", "0.1.0");
  Object.assign(button.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    background: "#FAA227",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: "999px",
    border: "0",
    fontWeight: "600",
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as CSSStyleDeclaration);

  const toast = createToast();

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Đang lưu…";
    const affiliateCookiePresent = hasExistingPublisherCookie();

    try {
      const resp = await new Promise<{ ok: boolean; code?: string; data?: any; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: "trackProduct", url: location.href, affiliateCookiePresent }, (r) =>
          resolve(r ?? { ok: false, code: "no_response" }),
        );
      });

      if (resp.ok) {
        toast.show("✅ Đã theo dõi giá. Bạn sẽ nhận email khi giá giảm.");
        button.textContent = "✓ Đã theo dõi";
        setTimeout(() => {
          button.textContent = "+ Theo dõi giá";
          button.disabled = false;
        }, 3000);
      } else if (resp.code === "signin_required") {
        toast.show("Mở tab đăng nhập SaleNoti…");
        button.disabled = false;
        button.textContent = "+ Theo dõi giá";
      } else if (resp.code === "free_tier_cap_reached") {
        toast.show("Free 10 sản phẩm đã đủ. Mở dashboard để nâng cấp Pro.");
        button.disabled = false;
        button.textContent = "+ Theo dõi giá";
      } else {
        toast.show(`Lỗi: ${resp.error ?? resp.code ?? "thử lại"}`);
        button.disabled = false;
        button.textContent = "+ Theo dõi giá";
      }
    } catch (e) {
      toast.show("Lỗi kết nối. Thử lại sau.");
      button.disabled = false;
      button.textContent = "+ Theo dõi giá";
    }
  });

  document.body.appendChild(button);
})();

function hasExistingPublisherCookie(): boolean {
  return document.cookie.split(";").some((c) => SHOPEE_AFFILIATE_COOKIE_RE.test(c.trim()));
}

function createToast() {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    bottom: "80px",
    right: "20px",
    zIndex: "2147483647",
    background: "rgba(26,26,26,0.92)",
    color: "white",
    padding: "10px 16px",
    borderRadius: "8px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    opacity: "0",
    transition: "opacity 0.2s",
    pointerEvents: "none",
    maxWidth: "320px",
  } as CSSStyleDeclaration);
  document.body.appendChild(el);
  let hide: ReturnType<typeof setTimeout> | null = null;
  return {
    show(msg: string) {
      el.textContent = msg;
      el.style.opacity = "1";
      if (hide) clearTimeout(hide);
      hide = setTimeout(() => (el.style.opacity = "0"), 3500);
    },
  };
}

function showDisclosureRequired() {
  if (document.getElementById("salenoti-disclosure-required")) return;
  const panel = document.createElement("div");
  panel.id = "salenoti-disclosure-required";
  Object.assign(panel.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    background: "#FFFAF0",
    color: "#1a1a1a",
    border: "1px solid #FBD38D",
    padding: "12px",
    borderRadius: "10px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    maxWidth: "300px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.16)",
  } as CSSStyleDeclaration);
  panel.innerHTML = `
    <strong>SaleNoti cần disclosure trước</strong>
    <p style="margin:6px 0 10px">Chúng tôi là affiliate price-tracker. Hãy đọc và đồng ý trước khi theo dõi giá.</p>
    <button id="salenoti-open-onboarding" type="button" style="background:#FAA227;color:white;border:0;border-radius:8px;padding:8px 10px;font-weight:600;cursor:pointer">Mở onboarding</button>
  `;
  document.body.appendChild(panel);
  document.getElementById("salenoti-open-onboarding")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "openOnboarding" });
  });
}
