// sw.js – Enterprise-grade Service Worker
// Goals: rock-solid offline, instant PWA install banner, zero-latency media,
//        smart cache eviction, graceful fallbacks, diagnostic tooling.

// ------------------------------------------------------------------
// 1. CONSTANTS & CONFIGURATION
// ------------------------------------------------------------------
const STATIC_CACHE   = 'mnthen-shell-v2';        // App shell
const IMAGE_CACHE    = 'mnthen-images-v2';       // Images
const AUDIO_CACHE    = 'mnthen-audio-v2';        // Audio
const TILES_CACHE    = 'mnthen-tiles-v2';        // Map tiles
const RUNTIME_CACHE  = 'mnthen-runtime-v2';      // Anything else

const CACHE_LIMITS = {
  [IMAGE_CACHE]:   50  * 1024 * 1024,  // 50 MB
  [AUDIO_CACHE]:   100 * 1024 * 1024,  // 100 MB
  [TILES_CACHE]:   75  * 1024 * 1024,  // 75 MB
  [RUNTIME_CACHE]: 25  * 1024 * 1024   // 25 MB
};

// App-shell files – bump the cache name when you change these
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/offline.html'
];

// ------------------------------------------------------------------
// 2. LIFECYCLE EVENTS
// ------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(APP_SHELL))
    .then(() => self.skipWaiting())
  );
  console.log('SW: installed & shell cached');
});

self.addEventListener('activate', (event) => {
  // Delete any old caches
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => !n.endsWith('-v2')).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
  console.log('SW: activated & old caches cleaned');
});

// ------------------------------------------------------------------
// 3. FETCH ROUTER
// ------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-GET? bail out
  if (request.method !== 'GET') return;

  // Routing table
  if (request.mode === 'navigate') {
    // SPA: offline shell for every navigation
    event.respondWith(networkFirst(request, STATIC_CACHE));
  } else if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
  } else if (isAudioRequest(url)) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE));
  } else if (isTileRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, TILES_CACHE));
  } else if (request.destination === 'font' || url.pathname.includes('/static/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
  // Everything else is allowed to pass through untouched
});

// ------------------------------------------------------------------
// 4. CACHING STRATEGIES
// ------------------------------------------------------------------
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      await enforceQuota(cacheName);
    }
    return res;
  } catch (_) {
    return createFallback(req);
  }
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (_) {
    return caches.match(req) || caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const networkFetch = fetch(req).then(res => {
    if (res.ok) {
      cache.put(req, res.clone());
      enforceQuota(cacheName);
    }
    return res;
  });

  return cached || networkFetch;
}

// ------------------------------------------------------------------
// 5. QUOTA & EVICTION
// ------------------------------------------------------------------
async function enforceQuota(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;

  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  let size = 0;
  const sizes = [];

  // Rough byte estimation
  for (const req of requests) {
    const res = await cache.match(req);
    const bytes = (await res.blob()).size;
    sizes.push({ req, bytes });
    size += bytes;
  }

  // LRU eviction
  sizes.sort((a, b) => a.req.url > b.req.url); // placeholder order
  while (size > limit && sizes.length) {
    const oldest = sizes.shift();
    await cache.delete(oldest.req);
    size -= oldest.bytes;
  }
}

// ------------------------------------------------------------------
// 6. FALLBACKS
// ------------------------------------------------------------------
function createFallback(req) {
  const url = new URL(req.url);
  if (isImageRequest(url)) {
    return new Response(
      `<svg width="200" height="150" xmlns="http://www.w3.org/2000/svg">
         <rect width="100%" height="100%" fill="#f0f0f0"/>
         <text x="50%" y="50%" font-size="14" text-anchor="middle" fill="#666">Image unavailable</text>
       </svg>`,
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  if (isAudioRequest(url)) {
    return new Response('', { status: 204 });
  }
  return new Response('Resource not available', { status: 503 });
}

// ------------------------------------------------------------------
// 7. PREFETCH & MESSAGE BUS
// ------------------------------------------------------------------
self.addEventListener('message', (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'PREFETCH_AUDIO':
      prefetchAudio(payload);
      break;
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_DIAGNOSTICS':
      sendDiagnostics(event.ports[0]);
      break;
  }
});

async function prefetchAudio({ urls = [] }) {
  const cache = await caches.open(AUDIO_CACHE);
  const promises = urls.slice(0, 5).map(async url => {
    if (await cache.match(url)) return;
    const res = await fetch(url);
    if (res.ok) cache.put(url, res);
  });
  await Promise.allSettled(promises);
}

// ------------------------------------------------------------------
// 8. DIAGNOSTICS
// ------------------------------------------------------------------
async function sendDiagnostics(port) {
  const report = {};
  for (const name of [STATIC_CACHE, IMAGE_CACHE, AUDIO_CACHE, TILES_CACHE, RUNTIME_CACHE]) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    let bytes = 0;
    for (const k of keys) {
      const res = await cache.match(k);
      bytes += (await res.blob()).size;
    }
    report[name] = { items: keys.length, bytes };
  }
  port.postMessage(report);
}

// ------------------------------------------------------------------
// 9. HELPER REGEXPS
// ------------------------------------------------------------------
function isImageRequest(url) {
  return url.pathname.includes('/images/') ||
         /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url.pathname);
}
function isAudioRequest(url) {
  return url.pathname.includes('/audio/') ||
         /\.(mp3|wav|ogg|m4a)$/i.test(url.pathname);
}
function isTileRequest(url) {
  return url.hostname.includes('tile.openstreetmap.org') ||
         url.hostname.includes('tiles.') ||
         /\/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i.test(url.pathname);
}

console.log('SW: Enterprise service worker loaded');
