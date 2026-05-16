// FR-EXT-001 options page — view/reset disclosure acknowledgment.
// NOTE: `status` is a reserved global on `window` in the DOM lib (window.status: string),
// so we MUST NOT name local variables `status` at module top-level. Use `statusEl` instead.

const statusEl = document.getElementById("ack-status")!;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;

async function refresh() {
  const { disclosureAcknowledgedAt, disclosureVersion } = await chrome.storage.local.get([
    "disclosureAcknowledgedAt",
    "disclosureVersion",
  ]);
  if (disclosureAcknowledgedAt) {
    const when = new Date(disclosureAcknowledgedAt).toLocaleString("vi-VN");
    statusEl.textContent = `Đã đồng ý: ${when} (version ${disclosureVersion ?? "v1"})`;
  } else {
    statusEl.textContent = "Chưa đồng ý disclosure.";
  }
}

resetBtn?.addEventListener("click", async () => {
  await chrome.storage.local.remove(["disclosureAcknowledgedAt", "disclosureVersion"]);
  await refresh();
});

refresh();

// Make this a module so future top-level identifiers don't accidentally pollute the global DOM scope.
export {};
