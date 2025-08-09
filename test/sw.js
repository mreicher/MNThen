// sw.js – Minnesota Then Service Worker 
// Version: 3.3.0 (Optimized)
const CACHE_VERSIONS = {
  STATIC:  'mnthen-static-v5',
  IMAGES:  'mnthen-images-v5',
  AUDIO:   'mnthen-audio-v6',
  TILES:   'mnthen-tiles-v5',
  RUNTIME: 'mnthen-runtime-v5'
};
const CACHE_LIMITS = {
  [CACHE_VERSIONS.IMAGES]:  100 * 1024 * 1024,
  [CACHE_VERSIONS.AUDIO]:   200 * 1024 * 1024,  // Increased for better audio caching
  [CACHE_VERSIONS.TILES]:   150 * 1024 * 1024,  // More tiles for smoother map experience
  [CACHE_VERSIONS.RUNTIME]:  50 * 1024 * 1024
};

// Performance tracking
let cacheHitCount = 0;
let cacheMissCount = 0;
let activeBackgroundUpdates = 0;
const MAX_CONCURRENT_BACKGROUND_UPDATES = 3;

// Track cache sizes to avoid recalculating
const cacheSizes = {};
const CACHE_SIZE_UPDATE_INTERVAL = 60000; // Update cache sizes every minute
let lastCacheSizeUpdate = 0;

// Track in-flight requests to avoid duplicates
const inFlightRequests = new Map();

// IMPROVED: More efficient cache quota enforcement
async function enforceCacheQuota(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;
  
  // Skip if we recently updated cache sizes
  const now = Date.now();
  if (now - lastCacheSizeUpdate < CACHE_SIZE_UPDATE_INTERVAL) {
    return;
  }
  
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    let totalSize = cacheSizes[cacheName] || 0;
    
    // If we don't have a cached size, calculate it
    if (totalSize === 0) {
      const items = [];
      
      // Calculate sizes more efficiently with batching
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
            // Remove corrupted entries
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
    
    // Only enforce if we're over the limit
    if (totalSize <= limit) return;
    
    // Sort by last accessed (if available) or by size
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
    
    // Sort by last accessed (oldest first) for better LRU
    items.sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    // Evict until under limit
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

// IMPROVED: Cache-first with request deduplication
async function cacheFirst(req, cacheName) {
  const url = req.url;
  
  // Check for in-flight request
  if (inFlightRequests.has(url)) {
    return inFlightRequests.get(url);
  }
  
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    
    if (hit) {
      cacheHitCount++;
      
      // Update last accessed time
      const response = hit.clone();
      response.headers.set('sw-last-accessed', Date.now().toString());
      await cache.put(req, response);
      
      return hit;
    }
    
    cacheMissCount++;
    
    // Create in-flight promise
    const fetchPromise = fetch(req).then(async (resp) => {
      if (resp.ok && resp.status < 400) {
        try {
          // Add last accessed header
          const responseClone = resp.clone();
          responseClone.headers.set('sw-last-accessed', Date.now().toString());
          
          await cache.put(req, responseClone);
          
          // Update cache size estimate
          const contentLength = resp.headers.get('content-length');
          if (contentLength) {
            const size = parseInt(contentLength, 10);
            cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
          }
          
          // Only enforce quota periodically
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
    
    // Try cache one more time as fallback
    const fallback = await caches.match(req);
    return fallback || new Response('Resource unavailable', { status: 503 });
  }
}

// IMPROVED: Map tile caching with throttled background updates
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  
  // Always return cached immediately if available
  if (cached) {
    cacheHitCount++;
    
    // Update last accessed time
    const response = cached.clone();
    response.headers.set('sw-last-accessed', Date.now().toString());
    await cache.put(req, response);
    
    // Background update with throttling
    if (activeBackgroundUpdates < MAX_CONCURRENT_BACKGROUND_UPDATES) {
      activeBackgroundUpdates++;
      
      // Don't await - run in background
      fetch(req).then(async (resp) => {
        if (resp.ok && resp.status < 400) {
          try {
            const responseClone = resp.clone();
            responseClone.headers.set('sw-last-accessed', Date.now().toString());
            await cache.put(req, responseClone);
            
            // Update cache size estimate
            const contentLength = resp.headers.get('content-length');
            if (contentLength) {
              const size = parseInt(contentLength, 10);
              cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
            }
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
      
      // Update cache size estimate
      const contentLength = resp.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
      }
    }
    return resp;
  } catch (error) {
    return new Response('Tile unavailable', { status: 503 });
  }
}

// UNCHANGED: Audio range handling (preserved for CORS compatibility)
async function networkFirstForAudioRange(req) {
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      // Only cache full file on first request, not every range request
      const cache = await caches.open(CACHE_VERSIONS.AUDIO);
      const fullReq = new Request(req.url, { method: 'GET' });
      const cached = await cache.match(fullReq);
      
      if (!cached) {
        // Only fetch and cache full file if not already cached
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
    // Better fallback - try to serve cached full file
    const cached = await caches.match(new Request(req.url));
    return cached || new Response('Audio unavailable', { status: 503 });
  }
}

// ADD: Enhanced performance monitoring
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_CACHE_STATS') {
    event.ports[0].postMessage({
      cacheHits: cacheHitCount,
      cacheMisses: cacheMissCount,
      hitRate: cacheHitCount / (cacheHitCount + cacheMissCount) * 100,
      activeBackgroundUpdates: activeBackgroundUpdates,
      cacheSizes: cacheSizes
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
    // Reset cache size tracking
    for (const key in cacheSizes) {
      cacheSizes[key] = 0;
    }
    lastCacheSizeUpdate = 0;
    event.ports[0].postMessage({ success: true });
  }
});

// ADD: Better error logging with performance metrics
self.addEventListener('error', (event) => {
  console.error('Service Worker Error:', event.error, {
    cacheHits: cacheHitCount,
    cacheMisses: cacheMissCount,
    activeBackgroundUpdates: activeBackgroundUpdates
  });
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker Unhandled Promise Rejection:', event.reason, {
    cacheHits: cacheHitCount,
    cacheMisses: cacheMissCount,
    activeBackgroundUpdates: activeBackgroundUpdates
  });
});

// ADD: Cache cleanup on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Delete old versions
          if (!Object.values(CACHE_VERSIONS).includes(cacheName)) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
          
          // Reset cache size tracking for current versions
          cacheSizes[cacheName] = 0;
          
          return Promise.resolve();
        })
      );
    })
  );
});

console.log('Service Worker 3.3.0: Optimized for performance with CORS-compatible audio handling');
