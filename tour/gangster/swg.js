// swg.js – Minnesota Then Service Worker
// Version: 4.4.4 
// FOR: Gangster Tour App

const SW_VERSION = '4.4.4';
const CACHE_CONFIG = {
  STATIC: `mnthen-static-v1-${SW_VERSION}`,
  TILES: `mnthen-tiles-v1-${SW_VERSION}`,
  DATA: `mnthen-data-v1-${SW_VERSION}`,
  AUDIO: `mnthen-audio-v1-${SW_VERSION}`,
  IMAGES: `mnthen-images-v1-${SW_VERSION}`
};

const MAX_STATIC_ENTRIES = 50;
const MAX_TILE_ENTRIES = 1500;
const MAX_AUDIO_ENTRIES = 100;
const MAX_DATA_ENTRIES = 50;
const MAX_IMAGE_ENTRIES = 100;

const TILE_DOMAINS = ['a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org'];
const TILE_REGEX = /https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/;
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;

async function manageCacheSize(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      const toDelete = keys.slice(0, keys.length - maxEntries);
      await Promise.all(toDelete.map(key => cache.delete(key)));
    }
  } catch (e) {
    console.warn(`[SW] Cache size manage fail: ${cacheName}`, e);
  }
}

async function cacheFirstForTiles(request) {
  const cache = await caches.open(CACHE_CONFIG.TILES);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  try {
    const cleanRequest = new Request(request.url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'default'
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(cleanRequest, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.ok && response.status === 200) {
      cache.put(request, response.clone()).catch(() => {});
      return response;
    }
    
    throw new Error(`Tile fetch failed: ${response.status}`);
  } catch (e) {
    console.warn('[SW] Tile fetch failed:', e.message);
    const fallback = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    return new Response(
      Uint8Array.from(atob(fallback), c => c.charCodeAt(0)),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store'
        }
      }
    );
  }
}

async function cacheFirst(request, cacheName = CACHE_CONFIG.STATIC) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);

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
    const response = await fetch(request, { cache: 'no-cache' });

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

async function handleMediaRequest(request) {
  if (request.headers.has('range')) {
    return fetch(request.clone(), { cache: 'no-cache', mode: 'cors' });
  }
  
  const cache = await caches.open(CACHE_CONFIG.AUDIO);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request, { mode: 'cors' });
  if (response.status === 200 && response.ok && response.type !== 'opaque') {
    cache.put(request, response.clone()).then(() => manageCacheSize(CACHE_CONFIG.AUDIO, MAX_AUDIO_ENTRIES));
  }
  return response;
}

// ---------- fetch handler ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  if (request.method !== 'GET') return;

  // HTML - always fresh
  if (request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // TILES - AGGRESSIVE MATCHING
  if (TILE_DOMAINS.some(domain => url.includes(domain)) || TILE_REGEX.test(url)) {
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
    event.respondWith(networkFirst(request));
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

// ---------- lifecycle ----------
self.addEventListener('install', (e) => {
  console.log(`[SW] ${SW_VERSION} installing`);
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  console.log(`[SW] ${SW_VERSION} activating`);
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.map(name => {
          if (!Object.values(CACHE_CONFIG).includes(name)) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log(`[SW] ${SW_VERSION} loaded`);
