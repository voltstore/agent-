// Service Worker — سورا · ديب · جولد
const CACHE = 'sdg-v1';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon.svg'];

// تخزين الأصول عند التثبيت
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// تفعيل وحذف الكاش القديم
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// الطلبات: خدمة الكاش للأصول الثابتة، الشبكة للـ API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // طلبات API تذهب للشبكة دائماً
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
    return;
  }

  // الأصول الثابتة من الكاش أولاً
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // تخزين الاستجابات الناجحة
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    }).catch(() => caches.match('/index.html'))
  );
});
