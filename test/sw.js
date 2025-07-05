const CACHE_NAME = 'mnthen-map-v1.2.0';
const DYNAMIC_CACHE = 'mnthen-dynamic-v1.2.0';
const TILE_CACHE = 'mnthen-tiles-v1.2.0';
const MEDIA_CACHE = 'mnthen-media-v1.2.0';

// Cache size limits to prevent storage bloat
const CACHE_LIMITS = {
  tiles: 500,      // ~50MB of map tiles
  media: 100,      // Audio/images for locations
  dynamic: 50      // Other dynamic content
};

// Assets to cache immediately on install
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/locations_main.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.7.1/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.7.1/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/js/bootstrap.bundle.min.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css'
];

// Install event - cache core assets
self.addEventListener('install', event => {
  console.log('SW: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('SW: Caching core assets');
        return cache.addAll(CORE_ASSETS.map(url => new Request(url, { mode: 'cors' })));
      })
      .then(() => {
        console.log('SW: Core assets cached');
        return self.skipWaiting();
      })
      .catch(error => {
        console.warn('SW: Failed to cache some core assets:', error);
        return self.skipWaiting(); // Still activate even if some assets fail
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('SW: Activating...');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        const validCaches = [CACHE_NAME, DYNAMIC_CACHE, TILE_CACHE, MEDIA_CACHE];
        return Promise.all(
          cacheNames.map(cacheName => {
            if (!validCaches.includes(cacheName)) {
              console.log('SW: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      
      // Claim all clients
      self.clients.claim(),
      
      // Send activation message
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: CACHE_NAME
          });
        });
      })
    ]).then(() => {
      console.log('SW: Activated successfully');
      
      // Perform cache cleanup
      performCacheCleanup();
    })
  );
});

// Fetch event - handle all network requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests and browser extension requests
  if (event.request.method !== 'GET' || url.protocol.startsWith('chrome-extension')) {
    return;
  }
  
  // Route requests to appropriate handlers
  if (isMapTile(url)) {
    event.respondWith(handleMapTile(event.request));
  } else if (isMediaRequest(url)) {
    event.respondWith(handleMedia(event.request));
  } else if (isCoreAsset(url)) {
    event.respondWith(handleCoreAsset(event.request));
  } else {
    event.respondWith(handleDynamic(event.request));
  }
});

// Handle map tile requests - optimized for frequent access
async function handleMapTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // Return cached tile immediately, but fetch fresh one in background
    fetchAndCache(request, TILE_CACHE);
    return cachedResponse;
  }
  
  // If not cached, fetch and cache
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone before caching
      const responseClone = response.clone();
      await cache.put(request, responseClone);
      
      // Manage cache size
      manageCacheSize(TILE_CACHE, CACHE_LIMITS.tiles);
    }
    return response;
  } catch (error) {
    console.warn('SW: Map tile fetch failed:', request.url);
    // Return a transparent tile as fallback
    return createTransparentTile();
  }
}

// Handle media (images, audio) - cache first strategy
async function handleMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseClone = response.clone();
      await cache.put(request, responseClone);
      
      // Manage cache size
      manageCacheSize(MEDIA_CACHE, CACHE_LIMITS.media);
    }
    return response;
  } catch (error) {
    console.warn('SW: Media fetch failed:', request.url);
    return new Response('', { status: 404 });
  }
}

// Handle core assets - cache first with network fallback
async function handleCoreAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseClone = response.clone();
      await cache.put(request, responseClone);
    }
    return response;
  } catch (error) {
    console.warn('SW: Core asset fetch failed:', request.url);
    return new Response('', { status: 503 });
  }
}

// Handle dynamic content - network first with cache fallback
async function handleDynamic(request) {
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      const responseClone = response.clone();
      await cache.put(request, responseClone);
      
      // Manage cache size
      manageCacheSize(DYNAMIC_CACHE, CACHE_LIMITS.dynamic);
    }
    return response;
  } catch (error) {
    // Try cache fallback
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    console.warn('SW: Dynamic content fetch failed:', request.url);
    return new Response('Offline', { status: 503 });
  }
}

// Helper functions for request classification
function isMapTile(url) {
  return url.hostname.includes('tile.openstreetmap.org') ||
         url.pathname.match(/\/\d+\/\d+\/\d+\.png$/);
}

function isMediaRequest(url) {
  const mediaExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.wav', '.ogg', '.m4a'];
  const pathname = url.pathname.toLowerCase();
  return mediaExtensions.some(ext => pathname.endsWith(ext)) ||
         url.hostname.includes('mnthen.com');
}

function isCoreAsset(url) {
  return CORE_ASSETS.some(asset => {
    const assetUrl = new URL(asset, self.location.origin);
    return url.href === assetUrl.href;
  }) || url.pathname.endsWith('.css') || url.pathname.endsWith('.js');
}

// Utility functions
async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
  } catch (error) {
    // Silent fail for background updates
  }
}

async function manageCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxItems) {
    // Remove oldest entries (FIFO)
    const itemsToDelete = keys.length - maxItems;
    for (let i = 0; i < itemsToDelete; i++) {
      await cache.delete(keys[i]);
    }
    console.log(`SW: Cleaned ${itemsToDelete} items from ${cacheName}`);
  }
}

function createTransparentTile() {
  // Create a small transparent PNG tile
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  ctx.globalAlpha = 0;
  ctx.fillRect(0, 0, 256, 256);
  
  return canvas.convertToBlob({ type: 'image/png' })
    .then(blob => new Response(blob, {
      status: 200,
      headers: { 'Content-Type': 'image/png' }
    }));
}

async function performCacheCleanup() {
  // Clean up caches periodically
  const cacheNames = [TILE_CACHE, MEDIA_CACHE, DYNAMIC_CACHE];
  
  for (const cacheName of cacheNames) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      // Remove items older than 7 days
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const dateHeader = response.headers.get('date');
          if (dateHeader) {
            const responseDate = new Date(dateHeader).getTime();
            if (responseDate < oneWeekAgo) {
              await cache.delete(request);
            }
          }
        }
      }
    } catch (error) {
      console.warn('SW: Cache cleanup failed for', cacheName, error);
    }
  }
}

// Handle messages from the main thread
self.addEventListener('message', event => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'PREFETCH_AUDIO':
      prefetchNearbyAudio(data);
      break;
    case 'CLEAR_CACHE':
      clearAllCaches();
      break;
    case 'GET_CACHE_STATUS':
      getCacheStatus().then(status => {
        event.ports[0].postMessage(status);
      });
      break;
  }
});

// Prefetch audio files for nearby locations
async function prefetchNearbyAudio(data) {
  const { userLocation, locations } = data;
  if (!userLocation || !locations) return;
  
  const PREFETCH_RADIUS = 1000; // 1000 meters
  const nearbyLocations = locations.filter(location => {
    const distance = calculateDistance(userLocation, location);
    return distance <= PREFETCH_RADIUS;
  });
  
  // Prefetch audio files for nearby locations
  const cache = await caches.open(MEDIA_CACHE);
  for (const location of nearbyLocations.slice(0, 5)) { // Limit to 5 locations
    if (location.audio) {
      try {
        const audioRequest = new Request(location.audio);
        const cachedResponse = await cache.match(audioRequest);
        
        if (!cachedResponse) {
          fetch(audioRequest).then(response => {
            if (response.ok) {
              cache.put(audioRequest, response.clone());
            }
          }).catch(() => {
            // Silent fail for prefetch
          });
        }
      } catch (error) {
        // Silent fail for prefetch
      }
    }
  }
}

function calculateDistance(pos1, pos2) {
  const R = 6371000; // Earth's radius in meters
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

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('SW: All caches cleared');
}

async function getCacheStatus() {
  const cacheNames = [CACHE_NAME, DYNAMIC_CACHE, TILE_CACHE, MEDIA_CACHE];
  const status = {};
  
  for (const cacheName of cacheNames) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      status[cacheName] = keys.length;
    } catch (error) {
      status[cacheName] = 0;
    }
  }
  
  return status;
}

// Log service worker lifecycle
console.log('SW: Service Worker script loaded');
