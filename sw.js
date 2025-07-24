// sw.js – Minnesota Then Service Worker
// Version: 3.1.0  (bumped for audio-range fix)
// Caching Strategy:
//   – Cache-first for static assets
//   – Network-first for HTML
//   – Stale-while-revalidate for map tiles
//   – Network-first with cache fallback for audio RANGE requests
//   – Cache-first for audio NON-range requests

// ------------------------------------------------------------------
// 1. CACHE CONFIGURATION
// ------------------------------------------------------------------
const CACHE_VERSIONS = {
  STATIC:  'mnthen-static-v4',
  IMAGES:  'mnthen-images-v4',
  AUDIO:   'mnthen-audio-v5',      // ← bump to force new cache
  TILES:   'mnthen-tiles-v4',
  RUNTIME: 'mnthen-runtime-v4'
};

const CACHE_LIMITS = {
  [CACHE_VERSIONS.IMAGES]:  100 * 1024 * 1024,
  [CACHE_VERSIONS.AUDIO]:   150 * 1024 * 1024,
  [CACHE_VERSIONS.TILES]:   100 * 1024 * 1024,
  [CACHE_VERSIONS.RUNTIME]:  50 * 1024 * 1024
};

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/locations_main.js',
  '/manifest.json',
  '/images/mnthenfav.ico',
  '/images/logo.webp',
  '/images/splash_screen.webp'
];

const MAP_ASSETS = [
  'https://cdn.jsdelivr.net/npm/leaflet@1.7.1/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.7.1/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css'
];

// ------------------------------------------------------------------
// 2. INSTALL & ACTIVATE (unchanged)
// ------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSIONS.STATIC)
      .then(c => c.addAll([...APP_SHELL, ...MAP_ASSETS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const whitelist = Object.values(CACHE_VERSIONS);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !whitelist.includes(k))
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ------------------------------------------------------------------
// 3. FETCH HANDLING  (audio range-aware)
// ------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url   = new URL(request.url);

  if (request.method !== 'GET') return;

  // 1) HTML navigation
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // 2) Audio RANGE or normal request?
  if (isAudioRequest(url)) {
    const rangeRequest = request.headers.has('range');
    if (rangeRequest) {
      // Chrome needs real network for seekable 206 responses
      event.respondWith(networkFirstForAudioRange(request));
    } else {
      // First full load – cache-first
      event.respondWith(cacheFirst(request, CACHE_VERSIONS.AUDIO));
    }
    return;
  }

  // 3) Images, tiles, static assets (unchanged)
  if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request, CACHE_VERSIONS.IMAGES));
  } else if (isMapTileRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, CACHE_VERSIONS.TILES));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, CACHE_VERSIONS.STATIC));
  } else {
    event.respondWith(networkFirst(request, CACHE_VERSIONS.RUNTIME));
  }
});

// ------------------------------------------------------------------
// 4. CACHING STRATEGY IMPLEMENTATIONS
// ------------------------------------------------------------------
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit   = await cache.match(req);
  if (hit) return hit;

  const resp = await fetch(req);
  if (resp.ok) {
    cache.put(req, resp.clone());
    enforceCacheQuota(cacheName);
  }
  return resp;
}

async function networkFirst(req, cacheName) {
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, resp.clone());
      enforceCacheQuota(cacheName);
    }
    return resp;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}

async function networkFirstWithOfflineFallback(req) {
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      const cache = await caches.open(CACHE_VERSIONS.STATIC);
      cache.put(req, resp.clone());
    }
    return resp;
  } catch {
    return (await caches.match(req)) || caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req).then(resp => {
    if (resp.ok) {
      cache.put(req, resp.clone());
      enforceCacheQuota(cacheName);
    }
    return resp;
  });

  return cached || fetchPromise;
}

// ------------------------------------------------------------------
// 5. AUDIO RANGE FIX
// ------------------------------------------------------------------
async function networkFirstForAudioRange(req) {
  // Always fetch from network for ranges, but cache full file
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      // Clone for cache (the full file is cached on first non-range hit)
      const cache = await caches.open(CACHE_VERSIONS.AUDIO);
      // Cache the full file URL without the Range header
      const fullReq = new Request(req.url, { method: 'GET' });
      const fullResp = await fetch(fullReq);
      if (fullResp.ok) cache.put(fullReq, fullResp.clone());
    }
    return resp;
  } catch {
    // Fallback to cached full file – will fail range but at least play from 0:00
    return (await caches.match(new Request(req.url))) || Response.error();
  }
}

// ------------------------------------------------------------------
// 6. CACHE QUOTA & HELPERS (unchanged)
// ------------------------------------------------------------------
async function enforceCacheQuota(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  let size = 0;
  const items = [];
  for (const k of keys) {
    const r = await cache.match(k);
    const b = await r.blob();
    items.push({ key: k, size: b.size });
    size += b.size;
  }
  items.sort((a, b) => a.size - b.size);
  while (size > limit && items.length) {
    const { key } = items.shift();
    await cache.delete(key);
    size -= key.size;
  }
}

// ------------------------------------------------------------------
// 7. MESSAGE & BACKGROUND SYNC (unchanged)
// ------------------------------------------------------------------
self.addEventListener('message', (e) => {
  // keep existing handlers
});

// ------------------------------------------------------------------
// 8. URL MATCHERS  (unchanged)
// ------------------------------------------------------------------
function isImageRequest(url) {
  return url.pathname.includes('/images/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.pathname);
}
function isAudioRequest(url) {
  return url.pathname.includes('/audio/') || /\.(mp3|ogg|wav|m4a)$/i.test(url.pathname);
}
function isMapTileRequest(url) {
  return url.host.includes('tile.openstreetmap') || /\/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i.test(url.pathname);
}
function isStaticAsset(url) {
  return url.origin === self.location.origin &&
         /\/(css|js|fonts)\//.test(url.pathname);
}

console.log('Service Worker 3.1.0: activated with audio-range support');
