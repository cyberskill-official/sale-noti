// FR-NOTIF-002 §3 — Service Worker for Web Push.
// Served at /service-worker.js with Cache-Control: no-store (handled in next.config or Vercel headers).

self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return {};
    }
  })();
  event.waitUntil(
    self.registration.showNotification(data.title ?? "SaleNoti", {
      body: data.body ?? "",
      icon: data.icon ?? "/icon-192.png",
      tag: data.tag ?? "salenoti-default", // OS-level dedup per FR-NOTIF-002 §1 #4
      data,
      badge: "/icon-72.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  const idem = event.notification.data?.idem;

  event.waitUntil(
    (async () => {
      // Analytics beacon — fire-and-forget.
      if (idem) {
        try {
          await fetch("/api/me/push/clicked", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idem }),
            keepalive: true,
          });
        } catch {}
      }
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => c.url.includes(new URL(url).host));
      if (existing) {
        await existing.focus();
        await existing.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })()
  );
});
