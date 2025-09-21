// sw.js – Minnesota Then Service Worker
// Version: 4.2.2 (iOS-optimised + 404-guard)

const CACHE_NAME        = 'mnthen-v4-ios-2';
const RUNTIME_CACHE     = 'mnthen-runtime-v4-ios';
const AUDIO_CACHE       = 'mnthen-audio-v4';

// iOS Safari cache size limits (conservative)
const MAX_CACHE_SIZE        = 50 * 1024 * 1024; // 50 MB total
const MAX_RUNTIME_ENTRIES   = 100;
const MAX_AUDIO_ENTRIES     = 20;

// Critical install-time shell
const STATIC_RESOURCES = [
  '/',
  '/index.html'
];

// Always-live assets
const NEVER_CACHE = [
  '/locations_main.js',
  '/manifest.json'
];

// Media patterns
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mpeg|mkv)$/i;

// ----------  helpers  ----------
function isIOSSafari() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
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
async function cacheFirst(request) {
  try {
    const cache   = await caches.open(CACHE_NAME);
    const cached  = await cache.match(request);
    if (cached) return cached;

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(request, {
      signal: controller.signal,
      cache : 'default'
    });
    clearTimeout(timeoutId);

    if (response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (e) {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request)) ||
           new Response('Resource unavailable', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(request, {
      signal : controller.signal,
      cache  : 'no-cache'
    });
    clearTimeout(timeoutId);

    if (response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone()).then(() => {
        manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
      }).catch(() => {});
    }
    return response;
  } catch (e) {
    const cache = await caches.open(RUNTIME_CACHE);
    return (await cache.match(request)) ||
           new Response('Network unavailable', { status: 503 });
  }
}

async function handleMediaRequest(request) {
  // iOS range-request handling
  if (request.headers.has('range')) {
    return fetch(request.clone(), { cache: 'no-cache', mode: 'cors' });
  }

  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request, {
    mode: 'cors',
    credentials: 'same-origin',
    cache: 'default'
  });

  // 404-guard: only cache successful, non-opaque responses
  if (response.status === 200 && response.ok && response.type !== 'opaque') {
    cache.put(request, response.clone()).then(() => {
      manageCacheSize(AUDIO_CACHE, MAX_AUDIO_ENTRIES);
    }).catch(() => {});
  }
  return response;
}

function shouldNeverCache(url) {
  return NEVER_CACHE.some(p => url.includes(p));
}
function isMediaFile(url) {
  return AUDIO_EXTENSIONS.test(url) || VIDEO_EXTENSIONS.test(url);
}

// ----------  fetch ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  if (request.method !== 'GET') return;
  if (shouldNeverCache(url)) {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
    return;
  }
  if (isMediaFile(url)) {
    event.respondWith(handleMediaRequest(request));
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
  console.log('[SW] 4.2.2 installing');
  e.waitUntil(
    caches.open(CACHE_NAME)
          .then(cache => cache.addAll(STATIC_RESOURCES))
          .catch(error => {
            console.error('[SW] Failed to cache static resources:', error);
            return Promise.resolve();
          })
          .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  console.log('[SW] 4.2.2 activating');
  e.waitUntil(
    Promise.all([
      caches.keys().then(names => Promise.all(
        names.map(n => (n !== CACHE_NAME && n !== RUNTIME_CACHE && n !== AUDIO_CACHE) ? caches.delete(n) : null)
      )),
      manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES),
      manageCacheSize(AUDIO_CACHE, MAX_AUDIO_ENTRIES)
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
      caches.delete(AUDIO_CACHE)
    ]).then(() => event.ports[0].postMessage({ success: true }))
     .catch(err => event.ports[0].postMessage({ success: false, error: err.message }));
  }

  if (data.type === 'MANAGE_CACHE_SIZE') {
    Promise.all([
      manageCacheSize(CACHE_NAME, 50),
      manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES),
      manageCacheSize(AUDIO_CACHE, MAX_AUDIO_ENTRIES)
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

console.log('[SW] 4.2.2 ready (404-guard + iOS-optimised)');
