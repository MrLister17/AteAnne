/* AteAnne service worker.
 * Caches only the public app shell (static build assets, icons, offline page)
 * so the installed app opens instantly and shows a friendly offline screen.
 * NEVER caches /api/* responses or private images: financial data must
 * always come fresh from the server (they are sent with Cache-Control: no-store).
 */
const VERSION = "ateanne-shell-v1";
const SHELL = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // private, always network

  // Immutable hashed build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network-first, offline fallback. Pages hold no private data (it is fetched client-side).
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline").then((r) => r || Response.error())));
  }
});
