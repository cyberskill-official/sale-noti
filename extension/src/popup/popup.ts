const badge = document.getElementById("state-badge")!;

chrome.storage.local.get(["disclosureAcknowledgedAt"]).then(({ disclosureAcknowledgedAt }) => {
  if (disclosureAcknowledgedAt) {
    badge.className = "badge badge-ok";
    badge.textContent = "Sẵn sàng theo dõi";
  } else {
    badge.className = "badge badge-warn";
    badge.textContent = "Chưa onboarded";
    const onboardingUrl = chrome.runtime.getURL("onboarding.html");
    const a = document.createElement("a");
    a.href = onboardingUrl;
    a.target = "_blank";
    a.textContent = " → Bắt đầu onboarding";
    badge.parentElement?.appendChild(a);
  }
});
