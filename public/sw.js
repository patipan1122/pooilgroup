// Pooilgroup Service Worker — minimal offline shell + drafts pass-through
// Strategy:
//   - Static asset (next/static, manifest, icons) → cache-first
//   - Navigation requests → network-first, fall back to cached shell
//   - API requests → network only (do NOT cache stale data)
// Drafts are saved in localStorage by the LIFF report form (already), so users
// can fill in offline. POST will fail and toast will guide retry.

const CACHE = "pooilgroup-v1";
const SHELL = ["/", "/home", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache API
  if (url.pathname.startsWith("/api/")) return;

  // Static assets — cache first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              const clone = res.clone();
              caches.open(CACHE).then((c) => c.put(req, clone));
              return res;
            })
            .catch(() => caches.match("/")),
      ),
    );
    return;
  }

  // Navigation — network first
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
    );
  }
});
