// FR-EXT-001 §1 #8 — onboarding gate. Stores disclosureAcknowledgedAt in chrome.storage.local.
const ackCheckbox = document.getElementById("consent-ack") as HTMLInputElement;
const continueBtn = document.getElementById("continue-btn") as HTMLButtonElement;

ackCheckbox?.addEventListener("change", () => {
  continueBtn.disabled = !ackCheckbox.checked;
});

continueBtn?.addEventListener("click", async () => {
  if (!ackCheckbox.checked) return;
  await chrome.storage.local.set({
    disclosureAcknowledgedAt: Date.now(),
    disclosureVersion: "v1",
  });
  await fetch("https://salenoti.vn/api/auth/disclosure-ack", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "affiliate_disclosure_v1", source: "extension" }),
  }).catch(() => {
    // The web app stores durable consent after sign-in if the user is not authenticated yet.
  });
  // Open the web app sign-in to bind a session cookie.
  await chrome.tabs.create({ url: "https://salenoti.vn/auth/sign-in?ext=1" });
  window.close();
});
