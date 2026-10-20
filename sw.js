// Versioned app-shell cache. Bump VERSION on every release.
// Cache-first for same-origin shell files; network-only for everything else (never caches
// api.anthropic.com, openfoodfacts or any other cross-origin call).
const VERSION = 'v3-b-2026-10-19-f9ddf015';
const CACHE = `shell-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => null));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Workout rest timer on a locked phone: the page posts {type:'wk-rest', at, title, options} when it goes to the background;
// the SW keeps itself alive until `at` and shows the end alert (tag 'wk-rest'), unless the page cancels on return.
let restTimer = 0, restDone = null;
const restCancel = () => { clearTimeout(restTimer); restTimer = 0; if (restDone) { restDone(); restDone = null; } };
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'skipWaiting') { self.skipWaiting(); return; }
  if (!d || typeof d !== 'object') return;
  if (d.type === 'wk-rest-cancel') { restCancel(); return; }
  if (d.type === 'wk-rest' && Number.isFinite(+d.at)) {
    restCancel();
    const ms = Math.max(0, Math.min(15 * 60 * 1000, +d.at - Date.now()));
    e.waitUntil(new Promise((resolve) => {
      restDone = resolve;
      restTimer = setTimeout(async () => {
        try {
          const shown = await self.registration.getNotifications({ tag: 'wk-rest' });
          if (!shown.length) await self.registration.showNotification(String(d.title || 'الراحة خلصت'), d.options || {});
          for (const n of await self.registration.getNotifications({ tag: 'wk-rest-now' })) n.close();
        } catch { /* best effort */ }
        restTimer = 0; restDone = null; resolve();
      }, ms);
    }));
  }
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '#/workout/session';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list[0];
    if (c) return c.focus();
    return self.clients.openWindow(`./${url}`);
  }));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API / OFF / anything cross-origin: straight to network
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)).catch(() => fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
