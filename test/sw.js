// sw.js – Minnesota Then Service Worker 
// Version: 3.2.0

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

// Add performance tracking
let cacheHitCount = 0;
let cacheMissCount = 0;

// IMPROVED: Better audio range handling
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

// FIXED: Cache quota enforcement
async function enforceCacheQuota(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;
  
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    let totalSize = 0;
    const items = [];
    
    // Calculate sizes more efficiently
    for (const key of keys) {
      try {
        const response = await cache.match(key);
        if (response) {
          const blob = await response.blob();
          const item = { 
            key, 
            size: blob.size, 
            lastAccessed: Date.now() // Add timestamp for LRU
          };
          items.push(item);
          totalSize += blob.size;
        }
      } catch (e) {
        // Remove corrupted entries
        await cache.delete(key);
      }
    }
    
    if (totalSize <= limit) return;
    
    // Sort by size (smallest first) for more intelligent eviction
    items.sort((a, b) => a.size - b.size);
    
    while (totalSize > limit && items.length > 0) {
      const item = items.shift();
      await cache.delete(item.key);
      totalSize -= item.size;
      console.log(`Evicted ${item.key.url} (${item.size} bytes)`);
    }
  } catch (error) {
    console.error('Cache quota enforcement failed:', error);
  }
}

// IMPROVED: Better cache-first with error handling
async function cacheFirst(req, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    
    if (hit) {
      cacheHitCount++;
      return hit;
    }
    
    cacheMissCount++;
    const resp = await fetch(req);
    
    if (resp.ok && resp.status < 400) {
      // Clone before consuming
      const responseClone = resp.clone();
      try {
        await cache.put(req, responseClone);
        enforceCacheQuota(cacheName);
      } catch (e) {
        console.warn('Failed to cache response:', e);
      }
    }
    
    return resp;
  } catch (error) {
    console.error('Cache-first strategy failed:', error);
    // Try cache one more time as fallback
    const fallback = await caches.match(req);
    return fallback || new Response('Resource unavailable', { status: 503 });
  }
}

// IMPROVED: Map tile caching with better error handling
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  
  // Always return cached immediately if available
  if (cached) {
    cacheHitCount++;
    
    // Background update (don't await)
    fetch(req).then(async (resp) => {
      if (resp.ok && resp.status < 400) {
        try {
          await cache.put(req, resp.clone());
          enforceCacheQuota(cacheName);
        } catch (e) {
          console.warn('Background tile update failed:', e);
        }
      }
    }).catch(() => {
      // Silent fail for background updates
    });
    
    return cached;
  }
  
  // No cache - fetch fresh
  cacheMissCount++;
  try {
    const resp = await fetch(req);
    if (resp.ok && resp.status < 400) {
      cache.put(req, resp.clone());
      enforceCacheQuota(cacheName);
    }
    return resp;
  } catch (error) {
    return new Response('Tile unavailable', { status: 503 });
  }
}

// ADD: Performance monitoring
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_CACHE_STATS') {
    event.ports[0].postMessage({
      cacheHits: cacheHitCount,
      cacheMisses: cacheMissCount,
      hitRate: cacheHitCount / (cacheHitCount + cacheMissCount) * 100
    });
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    const cacheName = event.data.cacheName;
    caches.delete(cacheName).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});

// ADD: Better error logging
self.addEventListener('error', (event) => {
  console.error('Service Worker Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker Unhandled Promise Rejection:', event.reason);
});

console.log('Service Worker 3.2.0: Enhanced with better caching and error handling');
