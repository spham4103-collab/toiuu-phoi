/**
 * Service Worker - PWA for Xếp Phôi CNC An Bình
 * Cache Version 10 - Bỏ qua cache cho Supabase API/Realtime/Storage & API cục bộ,
 * Network-First cho HTML và /js/supabaseClient.js
 */
const CACHE_NAME = 'toiuu-phoi-pwa-v10';
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

  // Bỏ qua hoàn toàn cache cho Supabase Database/Realtime/Storage và API nội bộ
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.in') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Network-First cho trang HTML chính và /js/supabaseClient.js để luôn nhận cấu hình/code mới nhất
  if (
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.pathname.endsWith('/js/supabaseClient.js')
  ) {
    event.respondWith(
      fetch(req).then(networkRes => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => caches.match(req).then(m => m || caches.match('index.html')))
    );
    return;
  }

  // Stale-While-Revalidate cho các static assets khác
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
