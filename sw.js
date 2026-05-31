// sw.js – Minnesota Then Service Worker
// Version: 4.5.2 (hybrid: update + timer + CORS audio + offline hardening)

const CACHE_NAME = 'mnthen-v4-ios-5';
const SHELL_CACHE = 'mnthen-shell-v5';
const RUNTIME_CACHE = 'mnthen-runtime-v5';
const AUDIO_CACHE = 'mnthen-audio-v5';
const TILE_CACHE = 'mnthen-tiles-v5';

const MAX_RUNTIME = 100;
const MAX_AUDIO = 100;
const MAX_TILES = 1500;
const MAX_SHELL = 50;

// Restore CORS audio domains
const CORS_AUDIO_DOMAINS = [
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  's3.amazonaws.com',
  'cloudfront.net'
];

const SHELL_RESOURCES = [
  '/',
  '/index.html',
  '/map.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/manifest.json',
  '/locations_main.js',
  '/images/logo.webp',
  '/images/index/index_1.jpg'
];

const AUDIO_EXTS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;
const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mpeg|mkv)$/i;
const TILE_REGEX = /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)/i;

// ---------- helpers ----------

function isCORSAudio(url) {
  try {
    const urlObj = new URL(url);
    return CORS_AUDIO_DOMAINS.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      // Delete in parallel for massive speed improvement over sequential await
      await Promise.all(
        keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key))
      );
    }
  } catch (e) {
    console.warn('[SW] trimCache failed safely:', e);
  }
}

// ---------- strategies ----------

async function cacheFirst(req, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(req, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (res.ok && res.status === 200 && res.type !== 'opaque') {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    // hit is guaranteed null here, avoiding dead code
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(req) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(req, { cache: 'no-cache', signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (res.ok && res.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone()).catch(() => {});
      trimCache(RUNTIME_CACHE, MAX_RUNTIME);
    }
    return res;
  } catch (e) {
    const cache = await caches.open(RUNTIME_CACHE);
    return (await cache.match(req)) || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);

  const update = fetch(req)
    .then(res => {
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    // If network fails and cache is null, returning undefined crashes e.respondWith. 
    // Return 503 instead.
    .catch(() => new Response('Offline', { status: 503 })); 

  return cached || update;
}

async function handleAudio(req) {
  if (req.headers.has('range')) {
    // Must catch offline failure on range requests to prevent SW crash
    return fetch(req).catch(() => new Response('Offline', { status: 503 }));
  }
  
  const cache = await caches.open(AUDIO_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;

  // Wrap in try/catch to prevent unhandled rejections when offline
  try {
    const corsMode = isCORSAudio(req.url) ? 'cors' : 'same-origin';
    const res = await fetch(req, { mode: corsMode, credentials: 'same-origin' });
    
    if (res.ok && res.status === 200 && res.type !== 'opaque') {
      cache.put(req, res.clone()).catch(() => {});
      trimCache(AUDIO_CACHE, MAX_AUDIO);
    }
    return res;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}

// ---------- fetch ----------

self.addEventListener('fetch', e => {
  const { request: req } = e;
  const url = req.url;

  if (req.method !== 'GET') return;

  if (req.destination === 'document') {
    e.respondWith(networkFirst(req));
    return;
  }

  // Performance: Evaluate high-traffic/cheap checks before expensive regexes
  if (TILE_REGEX.test(url)) {
    e.respondWith(cacheFirst(req, TILE_CACHE));
    return;
  }

  if (url.includes('/api/')) {
    e.respondWith(networkFirst(req));
    return;
  }

  if (url.includes('/locations_main.js')) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (AUDIO_EXTS.test(url) || VIDEO_EXTS.test(url)) {
    e.respondWith(handleAudio(req));
    return;
  }

  if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2)$/i.test(url)) {
    e.respondWith(cacheFirst(req));
    return;
  }

  e.respondWith(cacheFirst(req));
});

// ---------- lifecycle ----------

self.addEventListener('install', e => {
  console.log('[SW] 4.5.2 installing');
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL_RESOURCES))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.error('[SW] install failed:', err);
        throw err;
      })
  );
});

self.addEventListener('activate', e => {
  console.log('[SW] 4.5.2 activating');
  e.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.map(n => {
          if (![CACHE_NAME, SHELL_CACHE, RUNTIME_CACHE, AUDIO_CACHE, TILE_CACHE].includes(n)) {
            return caches.delete(n);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- messages ----------

self.addEventListener('message', e => {
  const { data } = e;
  if (!data) return;

  switch (data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      Promise.all([
        caches.delete(CACHE_NAME),
        caches.delete(SHELL_CACHE),
        caches.delete(RUNTIME_CACHE),
        caches.delete(AUDIO_CACHE),
        caches.delete(TILE_CACHE)
      ]).then(
        () => e.ports[0]?.postMessage({ success: true }),
        err => e.ports[0]?.postMessage({ success: false, error: err.message })
      );
      break;

    case 'CHECK_FOR_UPDATE':
      self.registration.update()
        .then(() => e.ports[0]?.postMessage({ updateAvailable: true }))
        .catch(() => e.ports[0]?.postMessage({ updateAvailable: false }));
      break;
  }
});

// ---------- error shields ----------

self.addEventListener('error', e => {
  console.error('[SW] error:', e.error);
  e.preventDefault();
});

self.addEventListener('unhandledrejection', e => {
  console.error('[SW] rejection:', e.reason);
  e.preventDefault();
});

console.log('[SW] 4.5.2 ready (hybrid: update + timeouts + CORS audio + offline hardening)');
