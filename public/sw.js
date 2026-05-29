// Pooilgroup Service Worker — minimal offline shell + drafts pass-through
// Strategy:
//   - Static asset (next/static, manifest, icons) → NETWORK-FIRST (cache = offline
//     fallback only). A cache-first strategy here masked deploys: the browser kept
//     serving the OLD cached CSS/JS, so shipped fixes appeared to "not work"
//     (CEO: sticky-header overlap looked unfixed across 3 deploys, 2026-05-29).
//   - Navigation requests → network-first, fall back to cached shell
//   - API requests → network only (do NOT cache stale data)
// Drafts are saved in localStorage by the LIFF report form (already), so users
// can fill in offline. POST will fail and toast will guide retry.
//
// Bump CACHE on every strategy change so activate() purges the stale cache.

const CACHE = "pooilgroup-v2";
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

  // Static assets — NETWORK-FIRST so a new deploy's CSS/JS is always picked up
  // immediately; the cache is only an offline fallback. (Was cache-first, which
  // served stale assets forever because the cache name never changed.)
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
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
