// FR-EXT-001 — service worker — handles trackProduct messages from content script.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "trackProduct") return;

  (async () => {
    try {
      const res = await fetch("https://api.salenoti.vn/v1/products/track", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-SaleNoti-Source": "ext",
        },
        body: JSON.stringify({
          url: msg.url,
          respect_other_publisher: Boolean(msg.affiliateCookiePresent),
        }),
      });
      if (res.status === 401) {
        sendResponse({ ok: false, code: "signin_required" });
        return;
      }
      if (!res.ok) {
        sendResponse({ ok: false, code: "track_failed", error: await res.text() });
        return;
      }
      sendResponse({ ok: true, data: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, code: "network_error", error: String(e) });
    }
  })();

  return true; // async response
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});
