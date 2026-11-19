/**
 * Service Worker - PWA for Xếp Phôi CNC An Bình
 * Cache Version 12 - Bỏ qua cache cho Supabase API/Realtime/Storage & API cục bộ,
 * Network-First cho HTML và /js/supabaseClient.js với fallback đúng từng nhánh URL
 */
const CACHE_NAME = 'toiuu-phoi-pwa-v12';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/projects.html',
  '/inventory.html',
  '/cnc.html',
  '/admin.html',
  '/toi-uu-engine.js',
  '/js/supabaseClient.js',
  '/logo_an_binh.jpg',
  '/workshop_config.json',
  '/manifest.json'
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

function pickRouteFallbackUrl(pathname) {
  const p = String(pathname || '/').toLowerCase();
  if (p.startsWith('/projects')) return '/projects.html';
  if (p.startsWith('/inventory')) return '/inventory.html';
  if (p.startsWith('/cnc')) return '/cnc.html';
  if (p.startsWith('/admin')) return '/admin.html';
  return '/index.html';
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
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
      }).catch(() => caches.match(req).then(m => m || caches.match(pickRouteFallbackUrl(url.pathname))))
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
