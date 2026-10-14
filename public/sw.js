/* Offline support: network-first for pages, cache-first for hashed assets, and
   stale-while-revalidate for puzzle packs so new packs arrive without blocking play.
   The app may be served twice on one origin (production at /, the beta at /beta/), each with its
   own worker: a worker only handles requests inside its scope and keeps a cache of its own. */
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE = `nonet-v1@${SCOPE}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["./", "./manifest.webmanifest", "./icons/icon-192.png"]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Old caches of this scope only ("nonet-v1" is the one from before scopes); the other scope's stay.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && (k === "nonet-v1" || k.endsWith(`@${SCOPE}`))).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  // Sync traffic is never served from a cache, whatever the rules below become.
  if (url.pathname.includes("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./", copy));
          return res;
        })
        .catch(() => caches.match("./").then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.includes("/packs/")) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(req);
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.includes("/assets/") || url.pathname.includes("/icons/"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
