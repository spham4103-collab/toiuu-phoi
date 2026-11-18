/**
 * Service Worker - Offline-First PWA for Xếp Phôi CNC An Bình
 * Cache Version 6 - Giao diện Responsive tối ưu đa thiết bị (Mobile, iPad, Laser CNC, Desktop)
 */
const CACHE_NAME = 'toiuu-phoi-pwa-v6';
const STATIC_ASSETS = [
  './',
  'index.html',
  'toi-uu-engine.js',
  'logo_an_binh.jpg',
  'workshop_config.json',
  'manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Bỏ qua các API dynamic gọi server hoặc SSE ntfy
  if (url.pathname.startsWith('/api/') || url.hostname.includes('ntfy.sh')) {
    return;
  }

  // Network-First cho trang HTML chính để luôn nhận code mới nhất
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).then(networkRes => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }

  // Stale-While-Revalidate cho static assets
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(networkRes => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
