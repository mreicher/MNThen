// sw.js – Minnesota Then Service Worker
// Version: 2.0.0
// Caching Strategy: Cache-first for static assets, network-first for HTML, stale-while-revalidate for map tiles

// ------------------------------------------------------------------
// 1. CACHE CONFIGURATION
// ------------------------------------------------------------------
const CACHE_VERSIONS = {
  STATIC: 'mnthen-static-v3',
  IMAGES: 'mnthen-images-v3',
  AUDIO: 'mnthen-audio-v3',
  TILES: 'mnthen-tiles-v3',
  RUNTIME: 'mnthen-runtime-v3'
};

const CACHE_LIMITS = {
  [CACHE_VERSIONS.IMAGES]: 100 * 1024 * 1024,   // 100MB
  [CACHE_VERSIONS.AUDIO]: 150 * 1024 * 1024,    // 150MB
  [CACHE_VERSIONS.TILES]: 100 * 1024 * 1024,    // 100MB
  [CACHE_VERSIONS.RUNTIME]: 50 * 1024 * 1024    // 50MB
};

// Core app shell - update version when changing these
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/js/locations_main.js',
  '/manifest.json',
  '/images/mnthenfav.ico',
  '/images/logo.webp',
  '/images/splash_screen.webp',
  '/images/social-share.jpg'
];

// Critical map assets
const MAP_ASSETS = [
  'https://cdn.jsdelivr.net/npm/leaflet@1.7.1/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.7.1/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css'
];

// ------------------------------------------------------------------
// 2. INSTALLATION
// ------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSIONS.STATIC)
      .then(cache => {
        return cache.addAll([...APP_SHELL, ...MAP_ASSETS]);
      })
      .then(() => self.skipWaiting())
      .then(() => {
        console.log('Service Worker: Installation complete');
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'SW_INSTALLED' });
          });
        });
      })
  );
});

// ------------------------------------------------------------------
// 3. ACTIVATION
// ------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  const cacheWhitelist = Object.values(CACHE_VERSIONS);
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => self.clients.claim())
    .then(() => {
      console.log('Service Worker: Activation complete');
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_ACTIVATED', version: '2.0.0' });
        });
      });
    })
  );
});

// ------------------------------------------------------------------
// 4. FETCH HANDLING
// ------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Handle different types of requests
  if (request.mode === 'navigate') {
    // HTML pages - network first with offline fallback
    event.respondWith(networkFirstWithOfflineFallback(request));
  } else if (isImageRequest(url)) {
    // Images - cache first
    event.respondWith(cacheFirst(request, CACHE_VERSIONS.IMAGES));
  } else if (isAudioRequest(url)) {
    // Audio - cache first
    event.respondWith(cacheFirst(request, CACHE_VERSIONS.AUDIO));
  } else if (isMapTileRequest(url)) {
    // Map tiles - stale while revalidate
    event.respondWith(staleWhileRevalidate(request, CACHE_VERSIONS.TILES));
  } else if (isStaticAsset(url)) {
    // Static assets - cache first
    event.respondWith(cacheFirst(request, CACHE_VERSIONS.STATIC));
  } else {
    // All other requests - network first
    event.respondWith(networkFirst(request, CACHE_VERSIONS.RUNTIME));
  }
});

// ------------------------------------------------------------------
// 5. CACHING STRATEGIES
// ------------------------------------------------------------------
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      await enforceCacheQuota(cacheName);
    }
    return networkResponse;
  } catch (error) {
    return generateFallbackResponse(request);
  }
}

async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
      await enforceCacheQuota(cacheName);
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || Response.error();
  }
}

async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_VERSIONS.STATIC);
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    throw new Error('Network response not OK');
  } catch (error) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      enforceCacheQuota(cacheName);
    }
    return networkResponse;
  });

  return cachedResponse || fetchPromise;
}

// ------------------------------------------------------------------
// 6. CACHE MANAGEMENT
// ------------------------------------------------------------------
async function enforceCacheQuota(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;

  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  let currentSize = 0;
  const items = [];

  // Calculate current cache size
  for (const key of keys) {
    const response = await cache.match(key);
    const blob = await response.blob();
    items.push({
      key,
      size: blob.size,
      lastUsed: response.headers.get('last-used') || Date.now()
    });
    currentSize += blob.size;
  }

  // Sort by last used (oldest first)
  items.sort((a, b) => a.lastUsed - b.lastUsed);

  // Remove oldest items until under limit
  while (currentSize > limit && items.length > 0) {
    const item = items.shift();
    await cache.delete(item.key);
    currentSize -= item.size;
  }
}

// ------------------------------------------------------------------
// 7. FALLBACK RESPONSES
// ------------------------------------------------------------------
function generateFallbackResponse(request) {
  const url = new URL(request.url);

  if (isImageRequest(url)) {
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
        <rect width="100%" height="100%" fill="#f0f0f0"/>
        <text x="50%" y="50%" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#666">Image not available</text>
      </svg>`,
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }

  if (isAudioRequest(url)) {
    return new Response(null, { status: 204 });
  }

  return new Response('Resource not available offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' }
  });
}

// ------------------------------------------------------------------
// 8. MESSAGE HANDLING
// ------------------------------------------------------------------
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'PREFETCH_AUDIO':
      handleAudioPrefetch(data);
      break;
      
    case 'CLEAR_CACHE':
      handleCacheClear();
      break;
      
    case 'GET_CACHE_INFO':
      handleCacheInfoRequest(event.ports[0]);
      break;
      
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});

async function handleAudioPrefetch({ locations = [], userLocation }) {
  if (!locations.length || !userLocation) return;

  // Sort locations by distance to user
  locations.sort((a, b) => {
    const distA = calculateDistance(userLocation, a);
    const distB = calculateDistance(userLocation, b);
    return distA - distB;
  });

  // Prefetch closest 5 audio files
  const cache = await caches.open(CACHE_VERSIONS.AUDIO);
  const toPrefetch = locations.slice(0, 5);
  
  for (const location of toPrefetch) {
    if (location.audio && !(await cache.match(location.audio))) {
      try {
        const response = await fetch(location.audio);
        if (response.ok) {
          await cache.put(location.audio, response);
          await enforceCacheQuota(CACHE_VERSIONS.AUDIO);
        }
      } catch (error) {
        console.log('Prefetch failed for:', location.audio, error);
      }
    }
  }
}

async function handleCacheClear() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('All caches cleared');
}

async function handleCacheInfoRequest(port) {
  const info = {};
  
  for (const [name, version] of Object.entries(CACHE_VERSIONS)) {
    const cache = await caches.open(version);
    const keys = await cache.keys();
    let size = 0;
    
    for (const key of keys) {
      const response = await cache.match(key);
      if (response) {
        const blob = await response.blob();
        size += blob.size;
      }
    }
    
    info[name] = {
      count: keys.length,
      size: formatBytes(size),
      limit: formatBytes(CACHE_LIMITS[version] || 0)
    };
  }
  
  port.postMessage(info);
}

// ------------------------------------------------------------------
// 9. HELPER FUNCTIONS
// ------------------------------------------------------------------
function isImageRequest(url) {
  return url.pathname.includes('/images/') || 
         /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.pathname);
}

function isAudioRequest(url) {
  return url.pathname.includes('/audio/') || 
         /\.(mp3|ogg|wav|m4a)$/i.test(url.pathname);
}

function isMapTileRequest(url) {
  return url.host.includes('tile.openstreetmap') ||
         /\/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i.test(url.pathname);
}

function isStaticAsset(url) {
  return url.origin === self.location.origin &&
         (url.pathname.includes('/css/') ||
          url.pathname.includes('/js/') ||
          url.pathname.includes('/fonts/'));
}

function calculateDistance(pos1, pos2) {
  const R = 6371000; // Earth radius in meters
  const lat1 = pos1.lat * Math.PI / 180;
  const lat2 = pos2.lat * Math.PI / 180;
  const deltaLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const deltaLng = (pos2.lng - pos1.lng) * Math.PI / 180;

  const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ------------------------------------------------------------------
// 10. BACKGROUND SYNC
// ------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag === 'update-locations') {
    event.waitUntil(updateLocations());
  }
});

async function updateLocations() {
  // Implement your background sync logic here
  console.log('Background sync: Updating locations');
}

console.log('Service Worker: Loaded successfully');
