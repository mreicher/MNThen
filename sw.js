// sw.js – Minnesota Then Service Worker
// Version: 4.6.4 (fixes PREFETCH_AUDIO handler, staleWhileRevalidate fallback,
//                 GEOLOCATION validation, and message handler hardening)

const CACHE_NAME    = 'mnthen-v4-ios-6';
const SHELL_CACHE   = 'mnthen-shell-v6';
const RUNTIME_CACHE = 'mnthen-runtime-v6';
const AUDIO_CACHE   = 'mnthen-audio-v6';
const TILE_CACHE    = 'mnthen-tiles-v6';

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

// FIXED: Proper stale-while-revalidate that never returns a failed network
// response when a cached copy exists. Also never returns 404/500 errors
// to the page if we have anything usable in cache.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });

  // Always try network in background
  const networkPromise = fetch(req)
    .then(res => {
      // Only cache successful responses
      if (res.ok && res.status === 200) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null); // Network failure → null, not an error response

  // If we have cached, return it immediately (network updates in background)
  if (cached) return cached;

  // No cache — must wait for network
  const networkRes = await networkPromise;
  
  // Network succeeded (any status) — return it
  if (networkRes) return networkRes;
  
  // Complete failure — nothing cached, network down
  return new Response('Offline', { status: 503 });
}

async function handleAudio(req) {
  // Range requests bypass cache (streaming audio)
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

// ---------- message handlers ----------

// FIXED: PREFETCH_AUDIO now handles the client's actual message format:
// { type: 'PREFETCH_AUDIO', data: { userLocation: {...}, locations: [...] } }
// Prefetches audio files for all nearby locations.
async function handlePrefetchAudio(data, port) {
  // Client wraps payload in .data; fall back to data itself for forward compat
  const payload = data?.data || data;
  const locations = payload?.locations;

  if (!Array.isArray(locations)) {
    port?.postMessage({ success: false, error: 'Invalid or missing locations array' });
    return;
  }

  // Filter to locations with audio URLs
  const audioUrls = locations
    .map(loc => loc?.audio)
    .filter(url => typeof url === 'string' && url.length > 0);

  if (audioUrls.length === 0) {
    port?.postMessage({ success: true, prefetched: 0, total: 0, message: 'No audio URLs found' });
    return;
  }

  // Prefetch all audio files in parallel
  const results = await Promise.allSettled(
    audioUrls.map(async (url) => {
      const req = new Request(url);
      const res = await handleAudio(req);
      return { url, ok: res.ok };
    })
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  const failed = results.filter(r => r.status === 'rejected' || !r.value.ok).length;

  port?.postMessage({
    success: true,
    prefetched: succeeded,
    failed: failed,
    total: audioUrls.length
  });
}

// FIXED: Hardened against raw JS content being passed as locations string.
// Silently ignores obvious garbage instead of spamming console with parse errors.
async function handleGeolocationRequest(data, port) {
  try {
    if (!data || typeof data !== 'object') {
      port?.postMessage({ success: false, error: 'Invalid request data' });
      return;
    }

    let locations = data.locations;

    // If locations were sent as a JSON string (old client), parse safely
    if (typeof locations === 'string') {
      // Guard against raw JS file content or other garbage
      const trimmed = locations.trim();
      if (trimmed.startsWith('const ') || trimmed.startsWith('var ') || trimmed.startsWith('let ')) {
        console.warn('[SW] GEOLOCATION: received raw JS content instead of JSON — ignoring');
        port?.postMessage({ success: false, error: 'locations is raw JS, not JSON' });
        return;
      }
      
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
  console.log('[SW] 4.6.4 installing');
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
  console.log('[SW] 4.6.4 activating');
  e.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.map(n => {
          if (![CACHE_NAME, SHELL_CACHE, RUNTIME_CACHE, AUDIO_CACHE, TILE_CACHE].includes(n)) {
            console.log('[SW] Deleting old cache:', n);
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
  if (!data || typeof data !== 'object') return;

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

    // FIXED: PREFETCH_AUDIO now handles the client's actual message format
    // { data: { userLocation, locations } } instead of expecting { url }
    case 'PREFETCH_AUDIO':
      handlePrefetchAudio(data, e.ports?.[0]);
      break;

    case 'GEOLOCATION':
      handleGeolocationRequest(data, e.ports?.[0]);
      break;

    default:
      // Silently ignore unknown message types
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

console.log('[SW] 4.6.4 ready (resilient install)');
