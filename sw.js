// sw.js – Minnesota Then Service Worker
// Version: 4.4.1 (offline-first, install-shell, stale-while-revalidate for locations, HTML always fresh)

const CACHE_NAME        = 'mnthen-v4-ios-4';
const RUNTIME_CACHE     = 'mnthen-runtime-v4-ios';
const AUDIO_CACHE       = 'mnthen-audio-v4';
const TILE_CACHE        = 'mnthen-tiles-v4';
const SHELL_CACHE       = 'mnthen-shell-v4';        // NEW: install-time shell

// iOS Safari cache quotas (conservative)
const MAX_CACHE_SIZE        = 80 * 1024 * 1024; // 80 MB total
const MAX_RUNTIME_ENTRIES   = 100;
const MAX_AUDIO_ENTRIES     = 100;
const MAX_TILE_ENTRIES      = 1500;
const MAX_SHELL_ENTRIES     = 50;

// ----------  install-time shell  ----------
// These assets are cached during install so the PWA works offline from first launch.
const SHELL_RESOURCES = [
  '/',
  '/index.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/manifest.json',
  '/locations_main.js',               // ← location summaries, coords, audio URLs
  '/images/logo.webp',
  '/images/index/index_1.jpg'
];

// Assets that must **never** be served from cache (always live).
const NEVER_CACHE = [];   // locations_main.js removed

// Media patterns
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mpeg|mkv)$/i;
const TILE_REGEX = /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)/i;

// CORS audio domains
const CORS_AUDIO_DOMAINS = [
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  's3.amazonaws.com',
  'cloudfront.net',
  'd1234567890.cloudfront.net'
];

// ----------  helpers  ----------
function isIOSSafari() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isCORSAudio(url) {
  try {
    const urlObj = new URL(url);
    return CORS_AUDIO_DOMAINS.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

async function manageCacheSize(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys  = await cache.keys();
    if (keys.length > maxEntries) {
      const toDelete = keys.length - maxEntries;
      for (let i = 0; i < toDelete; i++) await cache.delete(keys[i]);
    }
  } catch (e) {
    console.warn('[SW] cache size manage fail:', e);
  }
}

// ----------  strategies  ----------
async function cacheFirst(request, cacheName = CACHE_NAME) {
  try {
    const cache   = await caches.open(cacheName);
    const cached  = await cache.match(request);
    if (cached) return cached;

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(request, { signal: controller.signal, cache: 'default' });
    clearTimeout(timeoutId);

    if (response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (e) {
    const cache = await caches.open(cacheName);
    return (await cache.match(request)) || new Response('Resource unavailable', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
    clearTimeout(timeoutId);

    if (response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone()).then(() => manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
    }
    return response;
  } catch (e) {
    const cache = await caches.open(RUNTIME_CACHE);
    return (await cache.match(request)) || new Response('Network unavailable', { status: 503 });
  }
}

// Stale-while-revalidate for locations script / JSON
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(netRes => {
      if (netRes.ok && netRes.status === 200) cache.put(request, netRes.clone());
      return netRes;
    })
    .catch(() => cached || new Response('Content unavailable', { status: 503 }));
  return cached || fetchPromise;
}

async function handleMediaRequest(request) {
  if (request.headers.has('range')) {
    return fetch(request.clone(), { cache: 'no-cache', mode: 'cors' });
  }
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request, { mode: 'cors', credentials: 'same-origin', cache: 'default' });
  if (response.status === 200 && response.ok && response.type !== 'opaque') {
    cache.put(request, response.clone()).then(() => manageCacheSize(AUDIO_CACHE, MAX_AUDIO_ENTRIES));
  }
  return response;
}

// ----------  fetch ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  if (request.method !== 'GET') return;

  // ✅ NEW: Always fetch HTML documents fresh from the network
  if (request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (NEVER_CACHE.some(p => url.includes(p))) {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
    return;
  }
  if (AUDIO_EXTENSIONS.test(url) || VIDEO_EXTENSIONS.test(url)) {
    event.respondWith(handleMediaRequest(request));
    return;
  }
  if (TILE_REGEX.test(url)) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }
  if (url.includes('/locations_main.js')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2)$/i)) {
    event.respondWith(cacheFirst(request));
  } else if (url.includes('/api/') || url.includes('geolocation') || url.includes('weather')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

// ----------  lifecycle ----------
self.addEventListener('install', (e) => {
  console.log('[SW] 4.4.1 installing'); // ✅ Version bumped
  e.waitUntil(
    caches.open(SHELL_CACHE)
          .then(cache => cache.addAll(SHELL_RESOURCES))
          .catch(err => console.error('[SW] shell cache fail:', err))
          .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  console.log('[SW] 4.4.1 activating'); // ✅ Version bumped
  e.waitUntil(
    Promise.all([
      caches.keys().then(names => Promise.all(
        names.map(n => ![
          CACHE_NAME, RUNTIME_CACHE, AUDIO_CACHE,
          TILE_CACHE, SHELL_CACHE
        ].includes(n) ? caches.delete(n) : null)
      )),
      manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES),
      manageCacheSize(AUDIO_CACHE, MAX_AUDIO_ENTRIES),
      manageCacheSize(TILE_CACHE, MAX_TILE_ENTRIES),
      manageCacheSize(SHELL_CACHE, MAX_SHELL_ENTRIES)
    ]).then(() => self.clients.claim())
  );
});

// ----------  messages ----------
self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data) return;

  if (data.type === 'SKIP_WAITING') self.skipWaiting();

  if (data.type === 'CLEAR_CACHE') {
    Promise.all([
      caches.delete(CACHE_NAME),
      caches.delete(RUNTIME_CACHE),
      caches.delete(AUDIO_CACHE),
      caches.delete(TILE_CACHE),
      caches.delete(SHELL_CACHE)
    ]).then(() => event.ports[0].postMessage({ success: true }))
     .catch(err => event.ports[0].postMessage({ success: false, error: err.message }));
  }

  if (data.type === 'MANAGE_CACHE_SIZE') {
    Promise.all([
      manageCacheSize(SHELL_CACHE, MAX_SHELL_ENTRIES),
      manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES),
      manageCacheSize(AUDIO_CACHE, MAX_AUDIO_ENTRIES),
      manageCacheSize(TILE_CACHE, MAX_TILE_ENTRIES)
    ]).then(() => event.ports[0].postMessage({ success: true, message: 'cache size managed' }));
  }

  if (data.type === 'CHECK_FOR_UPDATE') {
    self.registration.update()
      .then(() => event.ports[0].postMessage({ updateAvailable: true }))
      .catch(() => event.ports[0].postMessage({ updateAvailable: false }));
  }
});

// ----------  error shields ----------
self.addEventListener('error', (e) => {
  console.error('[SW] global error', e.error);
  e.preventDefault();
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[SW] unhandled rejection', e.reason);
  e.preventDefault();
});

console.log('[SW] 4.4.1 ready (install-shell + offline-first + tile-cache + HTML always fresh)');
