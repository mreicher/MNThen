// sw.js – Minnesota Then Service Worker
// Version: 4.6.3 (fixes staleWhileRevalidate ignoreSearch, PREFETCH_AUDIO/GEOLOCATION split)

const CACHE_NAME    = 'mnthen-v4-ios-5';
const SHELL_CACHE   = 'mnthen-shell-v5';
const RUNTIME_CACHE = 'mnthen-runtime-v5';
const AUDIO_CACHE   = 'mnthen-audio-v5';
const TILE_CACHE    = 'mnthen-tiles-v5';

const MAX_RUNTIME = 100;
const MAX_AUDIO   = 100;
const MAX_TILES   = 1500;
const MAX_SHELL   = 50;

const CORS_AUDIO_DOMAINS = [
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  's3.amazonaws.com',
  'cloudfront.net'
];

const SHELL_RESOURCES = [
  '/',
  '/index.html',
  '/offline.html',
  '/map.html',
  '/css/map-styles.css',
  '/manifest.json',
  '/locations_main.js',
  '/images/logo.webp',
  '/images/header/index_header.jpg'
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
      await Promise.all(
        keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key))
      );
    }
  } catch (e) {
    console.warn('[SW] trimCache failed safely:', e);
  }
}

function normalizeRequest(req) {
  const url = new URL(req.url);
  if (url.pathname === '/' || url.pathname === '') {
    return new Request(url.origin + '/index.html');
  }
  return req;
}

// Safe JSON parse — returns null instead of throwing on invalid JSON
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Cache each resource individually — failures don't block others
async function cacheShellResources(cache) {
  const results = await Promise.all(
    SHELL_RESOURCES.map(async (path) => {
      const req = new Request(path, { cache: 'reload' });
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200) {
          await cache.put(req, res.clone());
          return { path, ok: true };
        }
        throw new Error('HTTP ' + res.status);
      } catch (err) {
        console.warn('[SW] Shell resource failed:', path, err.message);
        return { path, ok: false, error: err.message };
      }
    })
  );
  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).map(r => r.path);
  console.log('[SW] Cached', ok, '/', SHELL_RESOURCES.length, 'shell resources');
  if (failed.length) console.warn('[SW] Failed:', failed.join(', '));
}

// ---------- strategies ----------

async function cacheFirst(req, cacheName) {
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
    const cached = await cache.match(req);
    if (cached) return cached;

    const offline = await caches.match('/offline.html');
    return offline || new Response('Offline', { status: 503 });
  }
}

// FIXED: ignoreSearch so versioned URLs (e.g. ?v=1.0.9) hit the cache entry
// stored without a query string. Also falls back to cached copy if network
// fails rather than returning a bare 503 when there is something usable.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });

  const update = fetch(req)
    .then(res => {
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached || new Response('Offline', { status: 503 }));

  return cached || update;
}

async function handleAudio(req) {
  if (req.headers.has('range')) {
    return fetch(req).catch(() => new Response('Offline', { status: 503 }));
  }

  const cache = await caches.open(AUDIO_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;

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

// ---------- geolocation message handler (defensive) ----------

async function handleGeolocationRequest(data, port) {
  try {
    if (!data || typeof data !== 'object') {
      port?.postMessage({ success: false, error: 'Invalid request data' });
      return;
    }

    // If locations were sent as a JSON string (old client), parse safely.
    // Guard against receiving raw JS file content instead of JSON.
    let locations = data.locations;
    if (typeof locations === 'string') {
      locations = safeJsonParse(locations);
      if (locations === null) {
        console.warn('[SW] GEOLOCATION: locations string was not valid JSON — ignoring');
        port?.postMessage({ success: false, error: 'locations is not valid JSON' });
        return;
      }
    }
    if (!Array.isArray(locations)) {
      port?.postMessage({ success: false, error: 'Invalid locations data: expected array' });
      return;
    }

    port?.postMessage({ success: true, locationsCount: locations.length });
  } catch (err) {
    console.error('[SW] handleGeolocationRequest error:', err);
    port?.postMessage({ success: false, error: err.message });
  }
}

// ---------- audio prefetch handler ----------

// FIXED: PREFETCH_AUDIO was incorrectly falling through to handleGeolocationRequest.
// Now handled separately — fetches and caches a single audio URL sent by the client.
async function handlePrefetchAudio(data, port) {
  const url = data?.url;
  if (!url || typeof url !== 'string') {
    port?.postMessage({ success: false, error: 'Invalid or missing url' });
    return;
  }
  try {
    const req = new Request(url);
    await handleAudio(req);
    port?.postMessage({ success: true, url });
  } catch (err) {
    console.error('[SW] handlePrefetchAudio error:', err);
    port?.postMessage({ success: false, error: err.message });
  }
}

// ---------- fetch ----------

self.addEventListener('fetch', e => {
  const { request: rawReq } = e;
  const url = rawReq.url;

  if (rawReq.method !== 'GET') return;

  const req = normalizeRequest(rawReq);

  if (req.destination === 'document') {
    e.respondWith(networkFirst(req));
    return;
  }

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
    e.respondWith(cacheFirst(req, CACHE_NAME));
    return;
  }

  e.respondWith(cacheFirst(req, CACHE_NAME));
});

// ---------- lifecycle ----------

self.addEventListener('install', e => {
  console.log('[SW] 4.6.3 installing');
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cacheShellResources(cache))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.error('[SW] install error (non-fatal):', err);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', e => {
  console.log('[SW] 4.6.3 activating');
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

    // FIXED: PREFETCH_AUDIO now has its own handler instead of falling through
    // to handleGeolocationRequest, which caused the JSON parse error when the
    // client sent an audio URL or file content instead of a locations array.
    case 'PREFETCH_AUDIO':
      handlePrefetchAudio(data, e.ports?.[0]);
      break;

    case 'GEOLOCATION':
      handleGeolocationRequest(data, e.ports?.[0]);
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

console.log('[SW] 4.6.3 ready (resilient install)');
