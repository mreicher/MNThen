/*=====================================================================
   Minnesota Then – Service Worker (v4.4.1)
   Offline‑first shell + tile cache + HTML‑always‑fresh fallback
   + pre‑cached starter tiles + placeholder tile handling
=====================================================================*/

/*--------------------------------------------------------------
  1️⃣  Constants & configuration (original names preserved)
--------------------------------------------------------------*/
const CACHE_NAME        = 'mnthen-v4-ios-4';          // core UI assets
const RUNTIME_CACHE     = 'mnthen-runtime-v4-ios';    // API calls, story JSON, etc.
const AUDIO_CACHE       = 'mnthen-audio-v4';          // audio / video files
const TILE_CACHE        = 'mnthen-tiles-v4';          // OSM tiles
const SHELL_CACHE       = 'mnthen-shell-v4';          // install‑time shell

// iOS Safari cache‑quota (conservative)
const MAX_CACHE_SIZE        = 80 * 1024 * 1024; // 80 MiB soft limit
const MAX_RUNTIME_ENTRIES   = 100;
const MAX_AUDIO_ENTRIES     = 100;
const MAX_TILE_ENTRIES      = 1500;   // ~45 MB if each tile ≈30 KB
const MAX_SHELL_ENTRIES     = 50;

/*--------------------------------------------------------------
  2️⃣  Resources that must be cached during install
--------------------------------------------------------------*/
const SHELL_RESOURCES = [
  '/',                     // index
  '/index.html',
  '/map.html',           // <-- the map page (offline‑ready)
  '/offline.html',        // <-- fallback page
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/manifest.json',
  '/locations_main.js',   // location summaries, coords, audio URLs
  '/images/logo.webp',
  '/images/index/index_1.jpg'
];

/*--------------------------------------------------------------
  3️⃣  Assets that must never be served from cache
--------------------------------------------------------------*/
const NEVER_CACHE = [];   // keep empty – you can add URLs that must stay live

/*--------------------------------------------------------------
  4️⃣  Media patterns (regexes fixed with leading backslash)
--------------------------------------------------------------*/
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mpeg|mkv)$/i;
const TILE_REGEX       = /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)/i;

/*--------------------------------------------------------------
  5️⃣  CORS‑audio whitelist
--------------------------------------------------------------*/
const CORS_AUDIO_DOMAINS = [
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  's3.amazonaws.com',
  'cloudfront.net',
  'd1234567890.cloudfront.net'
];

/*--------------------------------------------------------------
  6️⃣  Helper utilities (debug, eviction, cache‑size, etc.)
--------------------------------------------------------------*/
let DEBUG = false;   // toggle via postMessage({type:'SET_DEBUG',enabled:true})

function dbg(...args) {
  if (DEBUG) console.log('[SW]', ...args);
}

/* Debounced eviction – prevents a flood of delete() calls */
const _evictionTimers = {};
function scheduleEviction(cacheName, maxEntries) {
  if (_evictionTimers[cacheName]) clearTimeout(_evictionTimers[cacheName]);
  _evictionTimers[cacheName] = setTimeout(() => {
    manageCacheSize(cacheName, maxEntries).catch(e => dbg('eviction error', e));
    delete _evictionTimers[cacheName];
  }, 30_000); // 30 s debounce
}

/* Trim a cache to a maximum number of entries */
async function manageCacheSize(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

/* Detect iOS Safari – retained for possible future use */
function isIOSSafari() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/* Returns true if the URL points to a domain we allow CORS‑audio caching for */
function isCORSAudio(url) {
  try {
    const u = new URL(url);
    return CORS_AUDIO_DOMAINS.some(d => u.hostname.includes(d));
  } catch {
    return false;
  }
}

/*--------------------------------------------------------------
  7️⃣  Fetch strategies (identical signatures to original)
--------------------------------------------------------------*/
/* Cache‑first – stores opaque responses only when a max‑age header is present */
async function cacheFirst(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
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

/* Network‑first – used for HTML documents, API calls, etc. */
async function networkFirst(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  let response;
  try {
    response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone())
         .then(() => scheduleEviction(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES))
         .catch(() => {});
    return response;
  }

  // Network failed – fall back to cache
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  return cached || new Response('Network unavailable', { status: 503 });
}

/* Stale‑while‑revalidate – used for the locations script */
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

/* Media handling (audio/video) – respects CORS whitelist */
async function handleMediaRequest(request) {
  if (request.headers.has('range')) {
    // Let the browser stream byte ranges directly.
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
         .then(() => scheduleEviction(AUDIO_CACHE, MAX_AUDIO_ENTRIES))
         .catch(() => {});
  }
  return response;
}

/*--------------------------------------------------------------
  8️⃣  Fetch event – routing logic (including navigation fallback)
--------------------------------------------------------------*/
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = request.url;

  /* ------------------------------------------------------------
     8.1 Navigation requests – try network first, fall back to
          the cached offline page.
     ------------------------------------------------------------ */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html'))
    );
    return; // stop further processing for navigation requests
  }

  /* ------------------------------------------------------------
     8.2 Existing routing (unchanged logic)
     ------------------------------------------------------------ */
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

  // Tile images – cache‑first, with placeholder fallback (see below)
  if (TILE_REGEX.test(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          // No tile cached – serve a tiny placeholder and cache it for next time
          return fetch('/images/tile-placeholder.png')
            .then(placeholder => {
              // Store the placeholder under the original tile URL
              cache.put(request, placeholder.clone()).catch(() => {});
              return placeholder;
            })
            .catch(() => new Response('Tile unavailable', { status: 404 }));
        })
      )
    );
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

  // API / geolocation / weather – network‑first
  if (url.includes('/api/') || url.includes('geolocation') || url.includes('weather')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Fallback – cache‑first for anything else
  event.respondWith(cacheFirst(request));
});

/*--------------------------------------------------------------
  9️⃣  Install – pre‑cache the shell + starter tiles
--------------------------------------------------------------*/
self.addEventListener('install', e => {
  dbg('installing version', CACHE_NAME);
  e.waitUntil(
    (async () => {
      // 1️⃣  Shell assets (including offline.html & amap.html)
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL_RESOURCES);

      // 2️⃣  Pre‑cache a modest starter tile region
      //    Adjust the coordinates/zoom to suit your “default offline area”.
      const tileCache = await caches.open(TILE_CACHE);
      const zoom = 13;                     // default zoom level
      const xStart = 1310, xEnd = 1314;    // example X tile range
      const yStart = 3160, yEnd = 3164;    // example Y tile range
      const starterTiles = [];

      for (let x = xStart; x <= xEnd; x++) {
        for (let y = yStart; y <= yEnd; y++) {
          starterTiles.push(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
        }
      }

      // Add the starter tiles (ignore failures – some tiles may be missing)
      await Promise.all(
        starterTiles.map(url => tileCache.add(url).catch(() => {}))
      );

      // Finish install
      await self.skipWaiting();
    })()
    .catch(err => dbg('install error', err))
  );
});

/*--------------------------------------------------------------
  🔟  Activate – clean old caches & enforce size limits
--------------------------------------------------------------*/
self.addEventListener('activate', e => {
  dbg('activating version', CACHE_NAME);
  const expected = [
    CACHE_NAME,
    RUNTIME_CACHE,
    AUDIO_CACHE,
    TILE_CACHE,
    SHELL_CACHE
  ];
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

/*--------------------------------------------------------------
  1️⃣1️⃣  Message handling – whitelist commands + new PRECACHE_TILES
--------------------------------------------------------------*/
self.addEventListener('message', event => {
  const { data, ports } = event;
  if (!data) return;

  const allowed = [
    'SKIP_WAITING',
    'CLEAR_CACHE',
    'MANAGE_CACHE_SIZE',
    'CHECK_FOR_UPDATE',
    'SET_DEBUG',
    'PRECACHE_TILES'          // new command for “download area for offline”
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

    case 'PRECACHE_TILES':
      // data.tiles should be an array of full tile URLs the UI wants cached
      if (!Array.isArray(data.tiles) || data.tiles.length === 0) {
        ports[0]?.postMessage({ success: false, error: 'No tile URLs supplied' });
        break;
      }
      caches.open(TILE_CACHE)
        .then(cache => cache.addAll(data.tiles))
        .then(() => ports[0]?.postMessage({ success: true, message: 'tiles cached' }))
        .catch(err => ports[0]?.postMessage({ success: false, error: err.message }));
      break;
  }
});

/*--------------------------------------------------------------
  1️⃣2️⃣  Global error handling – keep the SW alive
--------------------------------------------------------------*/
self.addEventListener('error', e => {
  dbg('global error', e.error);
  e.preventDefault();
});

self.addEventListener('unhandledrejection', e => {
  dbg('unhandled rejection', e.reason);
  e.preventDefault();
});

/*--------------------------------------------------------------
  1️⃣3️⃣  Ready log
--------------------------------------------------------------*/
dbg(`[SW] ${CACHE_NAME} ready (install-shell + offline-first + tile-cache + HTML always fresh)`);
