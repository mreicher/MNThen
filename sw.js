/* ------------------------------------------------------------------
   Minnesota Then – Service Worker (v4.4.1)
   Offline‑first shell + tile cache + HTML always fresh
   ---------------------------------------------------------------*/

// ------------------------------------------------------------------
// 1️⃣  Constants & configuration (original names preserved)
// ------------------------------------------------------------------
const CACHE_NAME        = 'mnthen-v4-ios-4';          // core static assets
const RUNTIME_CACHE     = 'mnthen-runtime-v4-ios';    // runtime API calls, HTML fallback
const AUDIO_CACHE       = 'mnthen-audio-v4';          // audio / video files
const TILE_CACHE        = 'mnthen-tiles-v4';          // OSM tiles
const SHELL_CACHE       = 'mnthen-shell-v4';          // install‑time shell

// iOS Safari cache quotas (conservative)
const MAX_CACHE_SIZE        = 80 * 1024 * 1024; // 80 MiB total (not enforced per‑cache)
const MAX_RUNTIME_ENTRIES   = 100;
const MAX_AUDIO_ENTRIES     = 100;
const MAX_TILE_ENTRIES      = 1500;
const MAX_SHELL_ENTRIES     = 50;

// ----------  install‑time shell ----------
const SHELL_RESOURCES = [
  '/', '/index.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/manifest.json',
  '/locations_main.js',               // location summaries, coords, audio URLs
  '/images/logo.webp',
  '/images/index/index_1.jpg',
  '/offline.html'                     // tiny fallback shown when shell is empty
];

// Assets that must **never** be served from cache (always live)
const NEVER_CACHE = [];   // ← left empty intentionally

// Media patterns – **fixed regexes** (added leading backslashes)
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mpeg|mkv)$/i;
const TILE_REGEX       = /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)/i;

// CORS audio domains
const CORS_AUDIO_DOMAINS = [
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  's3.amazonaws.com',
  'cloudfront.net',
  'd1234567890.cloudfront.net'
];

// ------------------------------------------------------------------
// 2️⃣  Helper utilities (same function names as original)
// ------------------------------------------------------------------
let DEBUG = false;   // toggled via postMessage({type:'SET_DEBUG',enabled:true})

function dbg(...args) {
  if (DEBUG) console.log('[SW]', ...args);
}

/**
 * Debounced eviction – prevents a flood of delete() calls.
 */
const _evictionTimers = {};
function _scheduleEviction(cacheName, maxEntries) {
  if (_evictionTimers[cacheName]) clearTimeout(_evictionTimers[cacheName]);
  _evictionTimers[cacheName] = setTimeout(() => {
    manageCacheSize(cacheName, maxEntries).catch(e => dbg('eviction error', e));
    delete _evictionTimers[cacheName];
  }, 30000); // 30 s debounce
}

/**
 * Trim a cache to a maximum number of entries.
 */
async function manageCacheSize(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length <= maxEntries) return;
  const toDelete = keys.length - maxEntries;
  for (let i = 0; i < toDelete; i++) {
    await cache.delete(keys[i]);
  }
}

/**
 * Detect iOS Safari – retained for possible future use.
 */
function isIOSSafari() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * Returns true if the URL points to a domain we allow CORS‑audio caching for.
 */
function isCORSAudio(url) {
  try {
    const u = new URL(url);
    return CORS_AUDIO_DOMAINS.some(d => u.hostname.includes(d));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// 3️⃣  Fetch strategies (identical signatures to original)
// ------------------------------------------------------------------

/**
 * Cache‑first strategy.
 * Stores opaque responses only when a max‑age directive is present,
 * otherwise skips caching them (to avoid uncontrolled storage growth).
 */
async function cacheFirst(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(request, { signal: controller.signal, cache: 'default' });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response && response.ok) {
    const clone = response.clone();
    const cc = clone.headers.get('cache-control') || '';
    const canCacheOpaque = clone.type === 'opaque' && /max-age=\d+/.test(cc);
    if (clone.type !== 'opaque' || canCacheOpaque) {
      cache.put(request, clone).catch(() => {});
    }
  }
  return response;
}

/**
 * Network‑first strategy – used for HTML documents and API calls.
 */
async function networkFirst(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone())
         .then(() => _scheduleEviction(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES))
         .catch(() => {});
    return response;
  }

  // Network failed – fall back to cache
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  return cached || new Response('Network unavailable', { status: 503 });
}

/**
 * Stale‑while‑revalidate – used for the locations script.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(netRes => {
      if (netRes && netRes.ok) cache.put(request, netRes.clone());
      return netRes;
    })
    .catch(() => cached || new Response('Content unavailable', { status: 503 }));
  return cached || fetchPromise;
}

/**
 * Media handling (audio/video). Range requests are streamed directly.
 * Cross‑origin audio is cached only when the domain is whitelisted.
 */
async function handleMediaRequest(request) {
  if (request.headers.has('range')) {
    // Let the browser handle byte‑range streaming.
    return fetch(request.clone(), { cache: 'no-cache', mode: 'cors' });
  }

  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const canCache = isCORSAudio(request.url);
  const response = await fetch(request, {
    mode: canCache ? 'cors' : 'no-cors',
    credentials: 'omit',
    cache: 'default'
  });

  if (response && response.ok && canCache) {
    const clone = response.clone();
    cache.put(request, clone)
         .then(() => _scheduleEviction(AUDIO_CACHE, MAX_AUDIO_ENTRIES))
         .catch(() => {});
  }
  return response;
}

// ------------------------------------------------------------------
// 4️⃣  Fetch event – routing logic (preserves original flow)
// ------------------------------------------------------------------
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = request.url;

  // HTML documents – always fresh
  if (request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Never‑cache list
  if (NEVER_CACHE.some(p => url.includes(p))) {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
    return;
  }

  // Audio / video
  if (AUDIO_EXTENSIONS.test(url) || VIDEO_EXTENSIONS.test(url)) {
    event.respondWith(handleMediaRequest(request));
    return;
  }

  // Tile images
  if (TILE_REGEX.test(url)) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }

  // Location script – stale‑while‑revalidate
  if (url.includes('/locations_main.js')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Static assets (css, js, images, fonts, etc.)
  if (/\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // API / geolocation / weather – network first
  if (url.includes('/api/') || url.includes('geolocation') || url.includes('weather')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Fallback – cache first for anything else
  event.respondWith(cacheFirst(request));
});

// ------------------------------------------------------------------
// 5️⃣  Install – pre‑cache the shell
// ------------------------------------------------------------------
self.addEventListener('install', e => {
  dbg('installing version', CACHE_NAME);
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_RESOURCES))
      .catch(err => dbg('shell cache fail:', err))
      .then(() => self.skipWaiting())
  );
});

// ------------------------------------------------------------------
// 6️⃣  Activate – clean old caches & enforce size limits
// ------------------------------------------------------------------
self.addEventListener('activate', e => {
  dbg('activating version', CACHE_NAME);
  const expected = [CACHE_NAME, RUNTIME_CACHE, AUDIO_CACHE, TILE_CACHE, SHELL_CACHE];
  e.waitUntil(
    Promise.all([
      // Delete any caches that are not part of the current version
      caches.keys().then(names =>
        Promise.all(
          names.map(n => (!expected.includes(n) ? caches.delete(n) : null))
        )
      ),
      // Enforce per‑cache entry limits
      manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES),
      manageCacheSize(AUDIO_CACHE,   MAX_AUDIO_ENTRIES),
      manageCacheSize(TILE_CACHE,    MAX_TILE_ENTRIES),
      manageCacheSize(SHELL_CACHE,   MAX_SHELL_ENTRIES)
    ]).then(() => self.clients.claim())
  );
});

// ------------------------------------------------------------------
// 7️⃣  Message handling – whitelist commands & add debug toggle
// ------------------------------------------------------------------
self.addEventListener('message', event => {
  const { data, ports } = event;
  if (!data) return;

  // Whitelisted command types
  const allowed = [
    'SKIP_WAITING',
    'CLEAR_CACHE',
    'MANAGE_CACHE_SIZE',
    'CHECK_FOR_UPDATE',
    'SET_DEBUG'
  ];
  if (!allowed.includes(data.type)) return;

  switch (data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      Promise.all([
        caches.delete(CACHE_NAME),
        caches.delete(RUNTIME_CACHE),
        caches.delete(AUDIO_CACHE),
        caches.delete(TILE_CACHE),
        caches.delete(SHELL_CACHE)
      ])
        .then(() => ports[0]?.postMessage({ success: true }))
        .catch(err => ports[0]?.postMessage({ success: false, error: err.message }));
      break;

    case 'MANAGE_CACHE_SIZE':
      Promise.all([
        manageCacheSize(SHELL_CACHE,   MAX_SHELL_ENTRIES),
        manageCacheSize(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES),
        manageCacheSize(AUDIO_CACHE,   MAX_AUDIO_ENTRIES),
        manageCacheSize(TILE_CACHE,    MAX_TILE_ENTRIES)
      ])
        .then(() => ports[0]?.postMessage({ success: true, message: 'cache size managed' }))
        .catch(err => ports[0]?.postMessage({ success: false, error: err.message }));
      break;

    case 'CHECK_FOR_UPDATE':
      self.registration.update()
        .then(() => ports[0]?.postMessage({ updateAvailable: true }))
        .catch(() => ports[0]?.postMessage({ updateAvailable: false }));
      break;

    case 'SET_DEBUG':
      DEBUG = !!data.enabled;
      dbg('debug mode', DEBUG);
      break;
  }
});

// ------------------------------------------------------------------
// 8️⃣  Global error handling – keep the SW alive
// ------------------------------------------------------------------
self.addEventListener('error', e => {
  dbg('global error', e.error);
  e.preventDefault();
});

self.addEventListener('unhandledrejection', e => {
  dbg('unhandled rejection', e.reason);
  e.preventDefault();
});

// ------------------------------------------------------------------
// 9️⃣  Ready log
// ------------------------------------------------------------------
dbg(`[SW] ${CACHE_NAME} ready (install-shell + offline-first + tile-cache + HTML always fresh)`);
