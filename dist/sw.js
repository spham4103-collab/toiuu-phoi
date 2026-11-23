/**
 * Service Worker - PWA for Xếp Phôi CNC An Bình
 * Cache Version 19 - Hỗ trợ WMS (4 nhóm vật tư, /vouchers, /css/shared.css, /js/shared-ui.js) & URL sạch,
 * Bỏ qua cache cho Supabase API/Realtime/Storage & API cục bộ,
 * Network-First cho HTML, /toi-uu-engine.js, /css/ và toàn bộ /js/ với fallback đúng từng nhánh URL
 */
const CACHE_NAME = 'toiuu-phoi-pwa-v20';
const STATIC_ASSETS = [
  '/',
  '/projects',
  '/inventory',
  '/vouchers',
  '/cnc',
  '/admin',
  '/index.html',
  '/projects.html',
  '/inventory.html',
  '/vouchers.html',
  '/cnc.html',
  '/admin.html',
  '/toi-uu-engine.js',
  '/js/supabaseClient.js',
  '/js/shared-ui.js',
  '/js/workshopExport.js',
  '/js/qr-scanner.js',
  '/css/shared.css',
  '/css/index.css',
  '/css/print-a4.css',
  '/js/index/state.js',
  '/js/index/profile-memory.js',
  '/js/index/warehouse-dispatch.js',
  '/js/index/project-manager.js',
  '/js/index/project-modals.js',
  '/js/index/cloud-sync.js',
  '/js/index/nesting-ui.js',
  '/js/index/export-import.js',
  '/js/index/auth-roles.js',
  '/js/index/igs-fusion-loader.js',
  '/js/index/init.js',
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
  if (p.startsWith('/cnc')) return '/cnc';
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

  // Network-First cho trang HTML chính, /toi-uu-engine.js, /css/ và toàn bộ /js/ để luôn nhận code mới nhất
  if (
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.pathname === '/toi-uu-engine.js' ||
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
