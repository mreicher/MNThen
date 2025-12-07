// swg.js – Minnesota Then Service Worker
// Version: 4.4.2 (fixed tile caching, cache name sync)
// FOR: Gangster Tour App

// MUST MATCH EXACTLY what's in your HTML file
const CACHE_CONFIG = {
  STATIC: 'mnthen-static-v1',
  TILES: 'mnthen-tiles-v1',
  DATA: 'mnthen-data-v1',
  AUDIO: 'mnthen-audio-v1',
  IMAGES: 'mnthen-images-v1'
};

// iOS Safari cache quotas (conservative)
const MAX_CACHE_SIZE        = 80 * 1024 * 1024;
const MAX_STATIC_ENTRIES    = 50;
const MAX_TILE_ENTRIES      = 1500;
const MAX_AUDIO_ENTRIES     = 100;
const MAX_DATA_ENTRIES      = 50;
const MAX_IMAGE_ENTRIES     = 100;

// ----------  install-time shell  ----------
const SHELL_RESOURCES = [
  '/',
  '/index.html',
  '/css/mnthen_tour_gangster.css', 
  '/locations_h.js',                
  '/manifest.json',
  '/images/logo.webp',
  '/images/mnthenfav.ico',
  'https://www.mnthen.com/images/gangster/mccord/gangster_mccord_3.jpg '
];

// Assets that must **never** be served from cache
const NEVER_CACHE = [];

// Media patterns
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;
const TILE_REGEX = /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/i;

// CORS audio domains
const CORS_AUDIO_DOMAINS = [
  'storage.googleapis.com',
  'firebasestorage.googleapis.com'
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

// ----------  Tile Strategy (CRITICAL FIX) ----------
async function cacheFirstForTiles(request) {
  const cache = await caches.open(CACHE_CONFIG.TILES);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    // Network with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(request, { 
      signal: controller.signal,
      cache: 'default',
      mode: 'cors' // CRITICAL for OpenStreetMap tiles
    });
    clearTimeout(timeoutId);

    if (response && response.status === 200) {
      cache.put(request, response.clone()).then(() => {
        manageCacheSize(CACHE_CONFIG.TILES, MAX_TILE_ENTRIES);
      });
      return response;
    }
    throw new Error('Tile fetch failed');
  } catch (e) {
    console.warn('[SW] Tile offline, serving minimal response');
    return new Response('Offline', { status: 503 });
  }
}

// The rest of your original functions remain unchanged...
async function cacheFirst(request, cacheName = CACHE_CONFIG.STATIC) {
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
      const cache = await caches.open(CACHE_CONFIG.DATA);
      cache.put(request, response.clone()).then(() => manageCacheSize(CACHE_CONFIG.DATA, MAX_DATA_ENTRIES));
    }
    return response;
  } catch (e) {
    const cache = await caches.open(CACHE_CONFIG.DATA);
    return (await cache.match(request)) || new Response('Network unavailable', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_CONFIG.DATA);
  const cached = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then(netRes => {
      if (netRes.ok && netRes.status === 200) {
        cache.put(request, netRes.clone());
        manageCacheSize(CACHE_CONFIG.DATA, MAX_DATA_ENTRIES);
      }
      return netRes;
    })
    .catch(() => cached || new Response('Content unavailable', { status: 503 }));

  return cached || fetchPromise;
}

async function handleMediaRequest(request) {
  if (request.headers.has('range')) {
    return fetch(request.clone(), { cache: 'no-cache', mode: 'cors' });
  }
  
  const cache = await caches.open(CACHE_CONFIG.AUDIO);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request, { 
    mode: 'cors', 
    credentials: 'same-origin',
    cache: 'default'
  });
  if (response.status === 200 && response.ok && response.type !== 'opaque') {
    cache.put(request, response.clone()).then(() => {
      manageCacheSize(CACHE_CONFIG.AUDIO, MAX_AUDIO_ENTRIES);
    });
  }
  return response;
}

// ----------  fetch handler ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  if (request.method !== 'GET') return;

  // HTML - always fresh
  if (request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (NEVER_CACHE.some(p => url.includes(p))) {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
    return;
  }

  // TILES - Use dedicated handler (CRITICAL FIX)
  if (TILE_REGEX.test(url)) {
    event.respondWith(cacheFirstForTiles(request));
    return;
  }

  // AUDIO/VIDEO
  if (AUDIO_EXTENSIONS.test(url) || url.match(/\.(mp4|webm|mov|avi|mpeg|mkv)$/i)) {
    event.respondWith(handleMediaRequest(request));
    return;
  }

  // LOCATIONS DATA
  if (url.includes('/locations_h.js')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // IMAGES
  if (url.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i)) {
    event.respondWith(cacheFirst(request, CACHE_CONFIG.IMAGES));
    return;
  }

  // STATIC (CSS, JS, fonts)
  if (url.match(/\.(css|js|woff|woff2|ttf|eot)$/i)) {
    event.respondWith(cacheFirst(request, CACHE_CONFIG.STATIC));
    return;
  }

  // DEFAULT
  event.respondWith(networkFirst(request));
});

// ----------  lifecycle ----------
self.addEventListener('install', (e) => {
  console.log('[SW] Tour App v4.4.2 installing');
  e.waitUntil(
    caches.open(CACHE_CONFIG.STATIC)
      .then(cache => cache.addAll(SHELL_RESOURCES))
      .catch(err => console.error('[SW] shell cache fail:', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  console.log('[SW] Tour App v4.4.2 activating');
  e.waitUntil(
    Promise.all([
      caches.keys().then(names => Promise.all(
        names.map(name => {
          if (!Object.values(CACHE_CONFIG).includes(name)) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      )),
      // Manage all cache sizes
      manageCacheSize(CACHE_CONFIG.STATIC, MAX_STATIC_ENTRIES),
      manageCacheSize(CACHE_CONFIG.TILES, MAX_TILE_ENTRIES),
      manageCacheSize(CACHE_CONFIG.AUDIO, MAX_AUDIO_ENTRIES),
      manageCacheSize(CACHE_CONFIG.DATA, MAX_DATA_ENTRIES),
      manageCacheSize(CACHE_CONFIG.IMAGES, MAX_IMAGE_ENTRIES)
    ]).then(() => {
      console.log('[SW] Activated and ready');
      return self.clients.claim();
    })
  );
});

// ----------  message handler ----------
self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data) return;

  if (data.type === 'SKIP_WAITING') {
    console.log('[SW] Skipping waiting...');
    self.skipWaiting();
  }

  if (data.type === 'CLEAR_CACHE') {
    Promise.all([
      caches.delete(CACHE_CONFIG.STATIC),
      caches.delete(CACHE_CONFIG.TILES),
      caches.delete(CACHE_CONFIG.DATA),
      caches.delete(CACHE_CONFIG.AUDIO),
      caches.delete(CACHE_CONFIG.IMAGES)
    ]).then(() => event.ports[0].postMessage({ success: true }))
     .catch(err => event.ports[0].postMessage({ success: false, error: err.message }));
  }

  if (data.type === 'MANAGE_CACHE_SIZE') {
    Promise.all([
      manageCacheSize(CACHE_CONFIG.STATIC, MAX_STATIC_ENTRIES),
      manageCacheSize(CACHE_CONFIG.TILES, MAX_TILE_ENTRIES),
      manageCacheSize(CACHE_CONFIG.AUDIO, MAX_AUDIO_ENTRIES),
      manageCacheSize(CACHE_CONFIG.DATA, MAX_DATA_ENTRIES),
      manageCacheSize(CACHE_CONFIG.IMAGES, MAX_IMAGE_ENTRIES)
    ]).then(() => event.ports[0].postMessage({ success: true, message: 'cache size managed' }));
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

console.log('[SW] Tour App v4.4.2 ready (cache-sync, tile-optimized)');
