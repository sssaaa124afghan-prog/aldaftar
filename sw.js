// Versioned app-shell cache. Bump VERSION on every release.
// Cache-first for same-origin shell files; network-only for everything else (never caches
// api.anthropic.com, openfoodfacts or any other cross-origin call).
const VERSION = 'v6-push-2026-10-31-b23d162a';
const CACHE = `shell-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  // take over right away so a new release never waits behind an old tab (iOS keeps PWAs alive for days)
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).catch(() => null));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Workout rest timer in the background — ANDROID / DESKTOP ONLY: the page posts {type:'wk-rest', at, title, options} when it
// goes to the background; the SW keeps itself alive until `at` and shows the end alert (tag 'wk-rest'), unless the page
// cancels on return. iOS freezes a locked/backgrounded PWA *and* its service worker, so this timer never fires there; the
// page only posts it where core/alerts.js alertEnv().bgAlerts is true. A locked iPhone needs a real Web Push (council/alerts.md).
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
// Lock-screen alert from the push Worker. The payload is encrypted end-to-end (RFC 8291) and always generic:
// {title, body, tag, url}. iOS REQUIRES a visible notification for every push, or Safari revokes the subscription,
// so this always shows one, even when the app is open.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const str = (v, max, def) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
  const title = str(d.title, 80, 'الراحة خلصت');
  const body = str(d.body, 160, '');
  const tag = typeof d.tag === 'string' && /^[\w-]{1,32}$/.test(d.tag) ? d.tag : 'wk-rest'; // 'wk-rest' = same tag as the local alerts → never doubles
  const url = typeof d.url === 'string' && /^#\/[\w/-]*$/.test(d.url) ? d.url : '#/workout';
  e.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body, tag, renotify: true, dir: 'rtl', lang: 'ar', silent: false,
      vibrate: [200, 100, 200, 100, 300], icon: './icon-192.png', badge: './icon-192.png',
      timestamp: Date.now(), data: { url },
    });
    for (const n of await self.registration.getNotifications({ tag: 'wk-rest-now' })) n.close(); // the «راحة لحد …» ongoing note
    // app open and on screen: it already rang locally, so close the banner after a moment
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (list.some((c) => c.visibilityState === 'visible' && c.focused)) {
      await new Promise((r) => setTimeout(r, 1500));
      for (const n of await self.registration.getNotifications({ tag })) n.close();
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const raw = e.notification.data && e.notification.data.url;
  const url = typeof raw === 'string' && /^#\/[\w/-]*$/.test(raw) ? raw : '#/workout';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    const c = list[0];
    if (c) { await c.focus(); c.postMessage({ type: 'open', url }); return; }
    return self.clients.openWindow(`./${url}`);
  }));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API / OFF / anything cross-origin: straight to network
  if (req.mode === 'navigate') {
    // network-first for the page itself (fresh release when online), cached copy offline or after 4 s
    e.respondWith((async () => {
      const cached = () => caches.match('./index.html').then((hit) => hit || caches.match(req));
      try {
        const net = fetch(req, { cache: 'no-store' });
        const res = await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; }
        return (await cached()) || res;
      } catch { return (await cached()) || fetch(req); }
    })());
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
