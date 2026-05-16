const status = document.getElementById("ack-status")!;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;

async function refresh() {
  const { disclosureAcknowledgedAt, disclosureVersion } = await chrome.storage.local.get([
    "disclosureAcknowledgedAt",
    "disclosureVersion",
  ]);
  if (disclosureAcknowledgedAt) {
    const when = new Date(disclosureAcknowledgedAt).toLocaleString("vi-VN");
    status.textContent = `Đã đồng ý: ${when} (version ${disclosureVersion ?? "v1"})`;
  } else {
    status.textContent = "Chưa đồng ý disclosure.";
  }
}

resetBtn?.addEventListener("click", async () => {
  await chrome.storage.local.remove(["disclosureAcknowledgedAt", "disclosureVersion"]);
  await refresh();
});

refresh();
