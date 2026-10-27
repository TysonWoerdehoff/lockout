// Lockout service worker: makes the app installable and lets it open with bad signal.
// App files are network-first (so new versions show up right away) with a cached fallback.
// Game data and video clips always go straight to the network.
const CACHE = 'lockout-mvqb928r';
const SHELL = ['./', 'index.html', 'app.js?v=mvqb928r', 'styles.css?v=mvqb928r', 'config.js?v=mvqb928r', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data?.json() || {}; } catch {}
  e.waitUntil(self.registration.showNotification(payload.title || 'Lockout', {
    body: payload.body || 'There is an update in your game.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.navigate(target).then(() => existing.focus()) : self.clients.openWindow(target);
  }));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live local data and clips must never be served from cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then((r) => r || caches.match('index.html')))
  );
});
