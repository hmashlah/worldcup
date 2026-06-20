// Service worker for WC2026 Prediction League PWA.
// Uses network-first for everything except static assets (JS/CSS/images)
// which use stale-while-revalidate. The cache name includes the SW file's
// own content hash (via Cloudflare's edge caching), so any code deploy
// that changes this file triggers a new SW install → old caches cleared.

const CACHE_NAME = 'wc26-20260620-4576';
const SHELL_URLS = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first for API calls, Supabase, and data files
  if (
    url.pathname.startsWith('/rest/') ||
    url.hostname.includes('supabase') ||
    url.pathname.endsWith('.json')
  ) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Stale-while-revalidate for static assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || fetched;
    })
  );
});
