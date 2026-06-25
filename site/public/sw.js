// Service worker for WC2026 Prediction League PWA.
// Uses network-first for everything except static assets (JS/CSS/images)
// which use stale-while-revalidate. The cache name is injected at build
// time so every deploy busts the old cache automatically.

const CACHE_NAME = '__SW_CACHE_VERSION__';
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

  // Only handle same-origin http(s) requests
  if (url.origin !== self.location.origin) return;

  // Network-first for API calls, Supabase, and data files
  if (
    url.pathname.startsWith('/rest/') ||
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

// ─── Push Notifications ───────────────────────────────────────────────
self.addEventListener('push', function(e) {
  var data;
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = {};
  }

  var title = data.title || 'WC2026';
  var options = {
    body: data.body || 'New notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };

  e.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || '/';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus an existing tab if possible
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    })
  );
});
