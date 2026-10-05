// App-shell-only caching (PRD Phase 5): static assets load instantly and the app installs offline-capable, but
// every API call goes straight to the network -- dashboard data must never be served stale from a cache.
const SHELL_CACHE = "enrollium-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // network-only for data

  // The page shell itself (navigations) must go network-first: cache-first on "/" meant the first deploy ever
  // installed got stuck in the cache forever -- a redeploy's fixed/updated HTML+JS never reached a returning
  // visitor because the fixed cache name (SHELL_CACHE) never changes between deploys, so the "clear old caches"
  // step in `activate` had nothing to actually clear. Falling back to the cache only kicks in when genuinely
  // offline, which is what the PWA offline-install requirement actually needs.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});

// Phase 6A: desktop/PWA push for new handoffs and leads (PRD: "a minimal alert -- no name or phone number --
// opening the lead or conversation when clicked"). The payload is exactly {title, body, url} -- see api/src/push.ts.
self.addEventListener("push", (event) => {
  let data = { title: "Enrollium", body: "You have a new alert.", url: "/" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* non-JSON payload: fall back to defaults */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url === url);
      if (existing) return existing.focus();
      const sameOrigin = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (sameOrigin) return sameOrigin.navigate(url).then((c) => c?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
