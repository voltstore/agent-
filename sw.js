// Service Worker — سورا · ديب · جولد
const CACHE = 'sdg-v8';
const ASSETS = ['/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API دائماً من الشبكة
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) return;

  // HTML — network first (يجلب الجديد دائماً، ويرجع للكاش فقط عند انقطاع النت)
  if (e.request.headers.get('accept')?.includes('text/html') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); } return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // الأصول الثابتة (أيقونات فقط) — cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
