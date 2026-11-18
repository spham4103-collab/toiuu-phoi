/**
 * Service Worker - Offline-First PWA for Xếp Phôi CNC An Bình
 * Cache Version 9 - Bỏ qua cache cho /database/*, API, Cloud & Tunnel để luôn nhận dữ liệu mới nhất
 */
const CACHE_NAME = 'toiuu-phoi-pwa-v9';
const STATIC_ASSETS = [
  './',
  'index.html',
  'projects.html',
  'inventory.html',
  'cnc.html',
  'admin.html',
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

  // Bỏ qua cache cho dữ liệu động (/database/*, /api/*, ntfy, GitHub raw, tunnel)
  if (
    url.pathname.startsWith('/database/') ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('ntfy.sh') ||
    url.hostname.includes('githubusercontent.com') ||
    url.hostname.includes('lhr.life')
  ) {
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
