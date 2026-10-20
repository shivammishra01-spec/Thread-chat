const CACHE_NAME = 'thread-cache-v43';
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Firebase SDK and fonts are loaded from other domains. Without saving them, the app page
// opens offline but Firebase never loads, so the app cannot start.
const CROSS_ORIGIN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/8.9.1/firebase-app.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/8.9.1/firebase-auth.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/8.9.1/firebase-firestore.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap'
];
const CACHED_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  // Cache each file on its own: one missing file (for example a missing icon)
  // must not make the whole install fail, or the app could never update.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        ...PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})),
        // no-cors gives an "opaque" response for scripts and CSS from other domains.
        // It cannot be inspected, but it can be stored and used offline.
        ...CROSS_ORIGIN_URLS.map((url) =>
          fetch(url, { mode: 'no-cors' }).then((res) => cache.put(url, res)).catch(() => {})
        )
      ])
    )
  );
  // Intentionally NOT calling skipWaiting() here: the new service worker
  // stays "waiting" until the page tells it to activate (see the
  // SKIP_WAITING message below). This is what lets the app show an
  // "update available" prompt instead of silently swapping versions.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Use the saved copy if there is one; otherwise fetch it and save it for next time.
function cacheFirstAndSave(req) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        cache.put(req, res.clone()).catch(() => {});
        return res;
      });
    })
  );
}

// Network-first for navigation/HTML so signed-in users always get fresh app code
// ("no-cache" makes the browser re-check with the server instead of reusing a
// copy from its own HTTP cache); falls back to the last good copy when offline.
// Cache-first for static assets (icons, manifest, Firebase SDK, fonts) so the app still loads offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    // Fresh copy when the network answers quickly; otherwise open the saved copy at once
    // (the fresh one is still downloaded in the background for next time).
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)).catch(() => {});
      }
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500))
      .then(() => caches.match('./index.html'))
      .then((cached) => cached || network);
    event.respondWith(
      Promise.race([network.catch(() => null), timeout]).then((res) => res || caches.match('./index.html') || network)
    );
    event.waitUntil(network.catch(() => {}));
    return;
  }

  const url = new URL(req.url);

  if (CACHED_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirstAndSave(req));
    return;
  }

  // Other cross-origin requests (Firebase API, storage files) go straight to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
