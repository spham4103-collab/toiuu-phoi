/**
 * Service Worker - PWA cho Hệ Thống Quản Lý Kho Vật Tư (WMS) An Bình
 * Bỏ qua cache cho Supabase API/Realtime/Storage & API cục bộ,
 * Network-First cho HTML, /css/ và toàn bộ /js/ với fallback đúng từng nhánh URL
 */
const CACHE_NAME = 'toiuu-phoi-pwa-v36';
const STATIC_ASSETS = [
  '/',
  '/projects',
  '/inventory',
  '/vouchers',
  '/purchasing',
  '/delivery',
  '/reports',
  '/admin',
  '/index.html',
  '/projects.html',
  '/inventory.html',
  '/vouchers.html',
  '/purchasing.html',
  '/delivery.html',
  '/reports.html',
  '/admin.html',
  '/js/supabaseClient.js',
  '/js/shared-ui.js',
  '/js/project-bom.js',
  '/js/inventory-smart.js',
  '/js/workshopExport.js',
  '/js/qr-scanner.js',
  '/css/shared.css',
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
  if (p.startsWith('/projects')) return '/projects';
  if (p.startsWith('/inventory')) return '/inventory';
  if (p.startsWith('/vouchers')) return '/vouchers';
  if (p.startsWith('/purchasing')) return '/purchasing';
  if (p.startsWith('/delivery')) return '/delivery';
  if (p.startsWith('/reports')) return '/reports';
  if (p.startsWith('/admin')) return '/admin';
  return '/';
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

  // Network-First cho trang HTML chính, /css/ và toàn bộ /js/ để luôn nhận code mới nhất
  if (
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/')
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
