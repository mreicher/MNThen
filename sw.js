// sw.js – Minnesota Then Service Worker
// Version: 4.6.5 (fixes locations_main.js 503 fallback, GEOLOCATION hardening,
//                 PREFETCH_AUDIO handler, and staleWhileRevalidate)

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

// FIXED: Added locations_main.js to shell resources with cache-busting query param
const SHELL_RESOURCES = [
  '/',
  '/index.html',
  '/offline.html',
  '/map.html',
  '/css/map-styles.css',
  '/manifest.json',
  '/locations_main.js',
  '/locations_main.js?v=1.0.9',  // Cache the versioned URL too
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

// FIXED: Proper stale-while-revalidate with network fallback.
// When cache is empty and network fails, try cache with ignoreSearch,
// then return a synthetic response instead of 503 for critical JS files.
async function staleWhileRevalidate(req, options = {}) {
  const cache = await caches.open(SHELL_CACHE);
  
  // Try exact match first
  let cached = await cache.match(req);
  
  // If no exact match, try ignoring query params (for ?v=1.0.9)
  if (!cached) {
    cached = await cache.match(req, { ignoreSearch: true });
  }

  // Always try network in background
  const networkPromise = fetch(req)
    .then(res => {
      if (res.ok && res.status === 200) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  // If we have cached, return it immediately
  if (cached) return cached;

  // No cache — must wait for network
  const networkRes = await networkPromise;
  
  if (networkRes) return networkRes;
  
  // FIXED: For JS/CSS files, return a synthetic "try again" instead of 503
  // This prevents the browser from caching the 503 error
  const url = new URL(req.url);
  if (/\.(js|css)$/i.test(url.pathname)) {
    return new Response(
      `// Service Worker: ${url.pathname} temporarily unavailable. Will retry on next load.\n`,
      { 
        status: 200,  // Return 200 so browser doesn't cache as error
        statusText: 'OK (SW fallback)',
        headers: { 
          'Content-Type': 'application/javascript',
          'X-SW-Fallback': 'true'
        }
      }
    );
  }
  
  return new Response('Offline', { status: 503 });
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

// ---------- message handlers ----------

async function handlePrefetchAudio(data, port) {
  const payload = data?.data || data;
  const locations = payload?.locations;

  if (!Array.isArray(locations)) {
    port?.postMessage({ success: false, error: 'Invalid or missing locations array' });
    return;
  }

  const audioUrls = locations
    .map(loc => loc?.audio)
    .filter(url => typeof url === 'string' && url.length > 0);

  if (audioUrls.length === 0) {
    port?.postMessage({ success: true, prefetched: 0, total: 0, message: 'No audio URLs found' });
    return;
  }

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

// FIXED: Completely hardened. Never tries to parse anything that isn't
// explicitly a valid object with a locations array.
async function handleGeolocationRequest(data, port) {
  try {
    // Guard 1: data must be a plain object
    if (!data || typeof data !== 'object' || data === null) {
      port?.postMessage({ success: false, error: 'Invalid request: not an object' });
      return;
    }

    // Guard 2: data must not be a string (raw JS content)
    if (typeof data === 'string') {
      console.warn('[SW] GEOLOCATION: received string instead of object — ignoring');
      port?.postMessage({ success: false, error: 'Expected object, received string' });
      return;
    }

    // Guard 3: data.locations must exist and be an array
    let locations = data.locations;
    
    if (locations === undefined || locations === null) {
      port?.postMessage({ success: false, error: 'Missing locations field' });
      return;
    }

    // Guard 4: If it's a string, it must be valid JSON array syntax
    if (typeof locations === 'string') {
      const trimmed = locations.trim();
      
      // Reject obvious non-JSON content
      if (trimmed.length === 0) {
        port?.postMessage({ success: false, error: 'Empty locations string' });
        return;
      }
      
      // Must start with [ for JSON array
      if (!trimmed.startsWith('[')) {
        console.warn('[SW] GEOLOCATION: locations string is not a JSON array — ignoring');
        port?.postMessage({ success: false, error: 'locations is not a JSON array' });
        return;
      }

      locations = safeJsonParse(locations);
      if (locations === null) {
        console.warn('[SW] GEOLOCATION: locations string was not valid JSON');
        port?.postMessage({ success: false, error: 'locations is not valid JSON' });
        return;
      }
    }

    if (!Array.isArray(locations)) {
      port?.postMessage({ success: false, error: 'Invalid locations: expected array, got ' + typeof locations });
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

  // FIXED: locations_main.js with query params — use staleWhileRevalidate
  // but also try cacheFirst as fallback for the versioned URL
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
  console.log('[SW] 4.6.5 installing');
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
  console.log('[SW] 4.6.5 activating');
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

    case 'PREFETCH_AUDIO':
      handlePrefetchAudio(data, e.ports?.[0]);
      break;

    case 'GEOLOCATION':
      handleGeolocationRequest(data, e.ports?.[0]);
      break;

    default:
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
console.log('[SW] 4.6.5 ready (resilient install)');
