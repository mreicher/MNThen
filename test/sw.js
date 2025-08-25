// sw.js – Minnesota Then Service Worker
// Version: 3.5.0 (With Enhanced Image Caching & CORS Proxy for Audio)
const CACHE_VERSIONS = {
  STATIC:  'mnthen-static-v5',
  IMAGES:  'mnthen-images-v5',
  AUDIO:   'mnthen-audio-v6',
  TILES:   'mnthen-tiles-v5',
  RUNTIME: 'mnthen-runtime-v5'
};

const CACHE_LIMITS = {
  [CACHE_VERSIONS.IMAGES]:  100 * 1024 * 1024,
  [CACHE_VERSIONS.AUDIO]:   200 * 1024 * 1024,
  [CACHE_VERSIONS.TILES]:   150 * 1024 * 1024,
  [CACHE_VERSIONS.RUNTIME]: 50 * 1024 * 1024
};

// Performance tracking
let cacheHitCount = 0;
let cacheMissCount = 0;
let activeBackgroundUpdates = 0;
const MAX_CONCURRENT_BACKGROUND_UPDATES = 3;

// Track cache sizes to avoid recalculating
const cacheSizes = {};
const CACHE_SIZE_UPDATE_INTERVAL = 60000;
let lastCacheSizeUpdate = 0;

// Track in-flight requests to avoid duplicates
const inFlightRequests = new Map();

// Position smoothing for reducing marker jumpiness
const positionBuffer = [];
const MAX_POSITION_BUFFER_SIZE = 5;
const POSITION_SMOOTHING_FACTOR = 0.3; // Lower = more smoothing
const MAX_POSITION_AGE = 10000; // 10 seconds

// Geolocation response caching to reduce jitter
const geolocationCache = new Map();
const GEOLOCATION_CACHE_TTL = 5000; // 5 seconds

// CORS PROXY CONFIGURATION
const CORS_PROXY_URL = 'https://cors-anywhere.herokuapp.com/';

// More efficient cache quota enforcement
async function enforceCacheQuota(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;
  
  const now = Date.now();
  if (now - lastCacheSizeUpdate < CACHE_SIZE_UPDATE_INTERVAL) {
    return;
  }
  
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    let totalSize = cacheSizes[cacheName] || 0;
    
    if (totalSize === 0) {
      const items = [];
      
      for (let i = 0; i < keys.length; i += 10) {
        const batch = keys.slice(i, i + 10);
        const batchPromises = batch.map(async (key) => {
          try {
            const response = await cache.match(key);
            if (response) {
              const blob = await response.blob();
              return { key, size: blob.size };
            }
            return null;
          } catch (e) {
            await cache.delete(key);
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        items.push(...batchResults.filter(item => item !== null));
      }
      
      totalSize = items.reduce((sum, item) => sum + item.size, 0);
      cacheSizes[cacheName] = totalSize;
      lastCacheSizeUpdate = now;
    }
    
    if (totalSize <= limit) return;
    
    const items = [];
    for (const key of keys) {
      try {
        const response = await cache.match(key);
        if (response) {
          const blob = await response.blob();
          items.push({ 
            key, 
            size: blob.size,
            lastAccessed: response.headers.get('sw-last-accessed') || Date.now()
          });
        }
      } catch (e) {
        await cache.delete(key);
      }
    }
    
    items.sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    while (totalSize > limit && items.length > 0) {
      const item = items.shift();
      await cache.delete(item.key);
      totalSize -= item.size;
      cacheSizes[cacheName] = totalSize;
    }
  } catch (error) {
    console.error('Cache quota enforcement failed:', error);
  }
}

// Position smoothing function
function smoothPosition(newPosition) {
  const now = Date.now();
  
  // Add new position to buffer
  positionBuffer.push({
    ...newPosition,
    timestamp: now
  });
  
  // Remove old positions
  while (positionBuffer.length > 0 && 
         now - positionBuffer[0].timestamp > MAX_POSITION_AGE) {
    positionBuffer.shift();
  }
  
  // Remove excess positions if buffer is too large
  while (positionBuffer.length > MAX_POSITION_BUFFER_SIZE) {
    positionBuffer.shift();
  }
  
  // If we don't have enough positions, return the new one
  if (positionBuffer.length < 2) {
    return newPosition;
  }
  
  // Calculate weighted average for smoothing
  let totalWeight = 0;
  let smoothedLat = 0;
  let smoothedLng = 0;
  let smoothedAccuracy = 0;
  
  // More recent positions get higher weight
  for (let i = 0; i < positionBuffer.length; i++) {
    const position = positionBuffer[i];
    const age = now - position.timestamp;
    const weight = Math.exp(-age / 5000); // Decay over 5 seconds
    
    smoothedLat += position.lat * weight;
    smoothedLng += position.lng * weight;
    smoothedAccuracy += position.accuracy * weight;
    totalWeight += weight;
  }
  
  if (totalWeight > 0) {
    smoothedLat /= totalWeight;
    smoothedLng /= totalWeight;
    smoothedAccuracy /= totalWeight;
  }
  
  // Apply additional smoothing factor
  const mostRecent = positionBuffer[positionBuffer.length - 1];
  const finalLat = mostRecent.lat * (1 - POSITION_SMOOTHING_FACTOR) + smoothedLat * POSITION_SMOOTHING_FACTOR;
  const finalLng = mostRecent.lng * (1 - POSITION_SMOOTHING_FACTOR) + smoothedLng * POSITION_SMOOTHING_FACTOR;
  
  return {
    lat: finalLat,
    lng: finalLng,
    accuracy: Math.min(mostRecent.accuracy, smoothedAccuracy),
    timestamp: now,
    speed: mostRecent.speed,
    heading: mostRecent.heading
  };
}

// Intercept and smooth geolocation requests
async function handleGeolocationRequest(request) {
  const url = new URL(request.url);
  const cacheKey = url.pathname + url.search;
  
  // Check if we have a recent cached response
  const cached = geolocationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < GEOLOCATION_CACHE_TTL) {
    return new Response(JSON.stringify(cached.position), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Fetch fresh position
  try {
    const response = await fetch(request);
    if (!response.ok) {
      return response;
    }
    
    const positionData = await response.json();
    
    // Smooth the position
    const smoothedPosition = smoothPosition(positionData.coords || positionData);
    
    // Create smoothed response
    const smoothedResponse = {
      ...positionData,
      coords: smoothedPosition
    };
    
    // Cache the smoothed position
    geolocationCache.set(cacheKey, {
      position: smoothedResponse,
      timestamp: Date.now()
    });
    
    // Clean up old cache entries
    if (geolocationCache.size > 20) {
      const oldestKey = geolocationCache.keys().next().value;
      geolocationCache.delete(oldestKey);
    }
    
    return new Response(JSON.stringify(smoothedResponse), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Geolocation request failed:', error);
    return new Response('{"error": "Location unavailable"}', {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Cache-first with request deduplication
async function cacheFirst(req, cacheName) {
  const url = req.url;
  
  // Check for in-flight request
  if (inFlightRequests.has(url)) {
    return inFlightRequests.get(url);
  }
  
  // Intercept geolocation requests for smoothing
  if (url.includes('geolocation') || url.includes('location')) {
    return handleGeolocationRequest(req);
  }
  
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    
    if (hit) {
      cacheHitCount++;
      
      const response = hit.clone();
      response.headers.set('sw-last-accessed', Date.now().toString());
      await cache.put(req, response);
      
      return hit;
    }
    
    cacheMissCount++;
    
    const fetchPromise = fetch(req).then(async (resp) => {
      if (resp.ok && resp.status < 400) {
        try {
          const responseClone = resp.clone();
          responseClone.headers.set('sw-last-accessed', Date.now().toString());
          
          await cache.put(req, responseClone);
          
          const contentLength = resp.headers.get('content-length');
          if (contentLength) {
            const size = parseInt(contentLength, 10);
            cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
          }
          
          if (Date.now() - lastCacheSizeUpdate > CACHE_SIZE_UPDATE_INTERVAL) {
            enforceCacheQuota(cacheName);
          }
        } catch (e) {
          console.warn('Failed to cache response:', e);
        }
      }
      return resp;
    }).finally(() => {
      inFlightRequests.delete(url);
    });
    
    inFlightRequests.set(url, fetchPromise);
    return fetchPromise;
  } catch (error) {
    console.error('Cache-first strategy failed:', error);
    inFlightRequests.delete(url);
    
    const fallback = await caches.match(req);
    return fallback || new Response('Resource unavailable', { status: 503 });
  }
}

// Map tile caching with preloading
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  
  if (cached) {
    cacheHitCount++;
    
    const response = cached.clone();
    response.headers.set('sw-last-accessed', Date.now().toString());
    await cache.put(req, response);
    
    // Background update with throttling
    if (activeBackgroundUpdates < MAX_CONCURRENT_BACKGROUND_UPDATES) {
      activeBackgroundUpdates++;
      
      fetch(req).then(async (resp) => {
        if (resp.ok && resp.status < 400) {
          try {
            const responseClone = resp.clone();
            responseClone.headers.set('sw-last-accessed', Date.now().toString());
            await cache.put(req, responseClone);
            
            const contentLength = resp.headers.get('content-length');
            if (contentLength) {
              const size = parseInt(contentLength, 10);
              cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
            }
            
            // Preload adjacent tiles for smoother panning
            preloadAdjacentTiles(req.url, cacheName);
          } catch (e) {
            console.warn('Background tile update failed:', e);
          }
        }
      }).catch(() => {
        // Silent fail for background updates
      }).finally(() => {
        activeBackgroundUpdates--;
      });
    }
    
    return cached;
  }
  
  // No cache - fetch fresh
  cacheMissCount++;
  try {
    const resp = await fetch(req);
    if (resp.ok && resp.status < 400) {
      const responseClone = resp.clone();
      responseClone.headers.set('sw-last-accessed', Date.now().toString());
      await cache.put(req, responseClone);
      
      const contentLength = resp.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
      }
      
      // Preload adjacent tiles for new tiles too
      preloadAdjacentTiles(req.url, cacheName);
    }
    return resp;
  } catch (error) {
    return new Response('Tile unavailable', { status: 503 });
  }
}

// Preload adjacent tiles for smoother map panning
async function preloadAdjacentTiles(tileUrl, cacheName) {
  try {
    const url = new URL(tileUrl);
    const pathParts = url.pathname.split('/');
    const z = parseInt(pathParts[pathParts.length - 3]);
    const x = parseInt(pathParts[pathParts.length - 2]);
    const y = parseInt(pathParts[pathParts.length - 1]);
    
    // Preload adjacent tiles (8 surrounding tiles)
    const adjacentTiles = [
      [z, x - 1, y - 1], [z, x, y - 1], [z, x + 1, y - 1],
      [z, x - 1, y],                   [z, x + 1, y],
      [z, x - 1, y + 1], [z, x, y + 1], [z, x + 1, y + 1]
    ];
    
    // Only preload if we have capacity
    if (activeBackgroundUpdates < MAX_CONCURRENT_BACKGROUND_UPDATES - 1) {
      adjacentTiles.forEach(([z, x, y]) => {
        const adjacentUrl = `${url.origin}/${z}/${x}/${y}.png`;
        
        // Check if already cached
        caches.open(cacheName).then(cache => {
          cache.match(adjacentUrl).then(cached => {
            if (!cached) {
              // Preload in background
              fetch(adjacentUrl).then(resp => {
                if (resp.ok) {
                  cache.put(adjacentUrl, resp);
                }
              }).catch(() => {
                // Silent fail
              });
            }
          });
        });
      });
    }
  } catch (error) {
    console.warn('Failed to preload adjacent tiles:', error);
  }
}

// Audio range handling with CORS proxy
async function networkFirstForAudioRange(req) {
  try {
    // Route audio requests through CORS proxy
    const proxyUrl = CORS_PROXY_URL + encodeURIComponent(req.url);
    const proxyRequest = new Request(proxyUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      mode: 'cors', // Enable CORS for proxy
      credentials: 'omit'
    });
    
    const resp = await fetch(proxyRequest);
    if (resp.ok) {
      const cache = await caches.open(CACHE_VERSIONS.AUDIO);
      const fullReq = new Request(req.url, { method: 'GET' });
      const cached = await cache.match(fullReq);
      
      if (!cached) {
        try {
          const fullResp = await fetch(fullReq);
          if (fullResp.ok) {
            cache.put(fullReq, fullResp.clone());
            enforceCacheQuota(CACHE_VERSIONS.AUDIO);
          }
        } catch (e) {
          console.warn('Failed to cache full audio file:', e);
        }
      }
    }
    return resp;
  } catch (error) {
    console.warn('Audio range request failed:', error);
    const cached = await caches.match(new Request(req.url));
    return cached || new Response('Audio unavailable', { status: 503 });
  }
}

// Intercept fetch requests to apply caching strategies
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Handle geolocation requests for position smoothing
  if (url.includes('geolocation') || url.includes('location')) {
    event.respondWith(handleGeolocationRequest(event.request));
    return;
  }

  // Handle map tile requests for preloading
  if (url.includes('/tiles/') || url.includes('.png') || url.includes('.jpg')) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_VERSIONS.TILES));
    return;
  }

  // Handle image requests (jpg, jpeg, png, gif, svg, webp)
  if (url.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i)) {
    event.respondWith(cacheFirst(event.request, CACHE_VERSIONS.IMAGES));
    return;
  }

  // Handle static assets (CSS, JS)
  if (url.match(/\.(css|js)$/i)) {
    event.respondWith(cacheFirst(event.request, CACHE_VERSIONS.STATIC));
    return;
  }

  // Handle audio requests with CORS proxy
  if (url.includes('audio') || url.includes('.mp3') || url.includes('.wav')) {
    event.respondWith(networkFirstForAudioRange(event.request));
    return;
  }

  // For all other requests, use network-first with fallback to cache
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

// Enhanced performance monitoring
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_CACHE_STATS') {
    event.ports[0].postMessage({
      cacheHits: cacheHitCount,
      cacheMisses: cacheMissCount,
      hitRate: cacheHitCount / (cacheHitCount + cacheMissCount) * 100,
      activeBackgroundUpdates: activeBackgroundUpdates,
      cacheSizes: cacheSizes,
      positionBufferSize: positionBuffer.length
    });
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    const cacheName = event.data.cacheName;
    caches.delete(cacheName).then(() => {
      cacheSizes[cacheName] = 0;
      event.ports[0].postMessage({ success: true });
    });
  }
  
  if (event.data && event.data.type === 'RESET_CACHE_SIZES') {
    for (const key in cacheSizes) {
      cacheSizes[key] = 0;
    }
    lastCacheSizeUpdate = 0;
    event.ports[0].postMessage({ success: true });
  }
  
  // Clear position buffer on request
  if (event.data && event.data.type === 'CLEAR_POSITION_BUFFER') {
    positionBuffer.length = 0;
    geolocationCache.clear();
    event.ports[0].postMessage({ success: true });
  }
});

// Better error logging
self.addEventListener('error', (event) => {
  console.error('Service Worker Error:', event.error, {
    cacheHits: cacheHitCount,
    cacheMisses: cacheMissCount,
    activeBackgroundUpdates: activeBackgroundUpdates,
    positionBufferSize: positionBuffer.length
  });
});
self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker Unhandled Promise Rejection:', event.reason, {
    cacheHits: cacheHitCount,
    cacheMisses: cacheMissCount,
    activeBackgroundUpdates: activeBackgroundUpdates,
    positionBufferSize: positionBuffer.length
  });
});

// Cache cleanup on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!Object.values(CACHE_VERSIONS).includes(cacheName)) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
          
          cacheSizes[cacheName] = 0;
          return Promise.resolve();
        })
      );
    })
  );
  
  // Take control of all open clients immediately
  return self.clients.claim();
});

// Install event - cache critical resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSIONS.STATIC).then(cache => {
      return cache.addAll([
        '/',
        '/index.html',
        '/placeholder.svg',
        '/manifest.json'
      ]);
    })
  );
});
console.log('Service Worker 3.5.0: With enhanced image caching and CORS proxy for audio');
