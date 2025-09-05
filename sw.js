// sw.js – Minnesota Then Service Worker
// Version: 3.6.0 (Enhanced with robust error handling and optimized CORS proxy)
const CACHE_VERSIONS = {
  STATIC: 'mnthen-static-v6',
  IMAGES: 'mnthen-images-v6',
  AUDIO: 'mnthen-audio-v7',
  TILES: 'mnthen-tiles-v6',
  RUNTIME: 'mnthen-runtime-v6'
};

const CACHE_LIMITS = {
  [CACHE_VERSIONS.IMAGES]: 100 * 1024 * 1024,
  [CACHE_VERSIONS.AUDIO]: 200 * 1024 * 1024,
  [CACHE_VERSIONS.TILES]: 150 * 1024 * 1024,
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
const POSITION_SMOOTHING_FACTOR = 0.3;
const MAX_POSITION_AGE = 10000;

// Geolocation response caching to reduce jitter
const geolocationCache = new Map();
const GEOLOCATION_CACHE_TTL = 5000;

// Multiple CORS proxy fallbacks for maximum reliability
const CORS_PROXIES = [
  'https://cors-anywhere.herokuapp.com/',
  'https://proxy.cors.sh/',
  'https://corsproxy.io/?',
  'https://cors.bridged.cc/'
];
let currentProxyIndex = 0;

// Robust CORS proxy with automatic fallback
async function fetchWithCORSProxy(url, options = {}) {
  const maxRetries = CORS_PROXIES.length;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const proxyUrl = CORS_PROXIES[currentProxyIndex];
    let finalUrl;
    
    try {
      if (proxyUrl.includes('corsproxy.io')) {
        finalUrl = proxyUrl + encodeURIComponent(url);
      } else if (proxyUrl.includes('cors.bridged.cc')) {
        finalUrl = proxyUrl + url;
      } else {
        finalUrl = proxyUrl + url;
      }
      
      const proxyRequest = new Request(finalUrl, {
        method: options.method || 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': self.location.origin,
          ...options.headers
        },
        body: options.body,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-cache'
      });
      
      const response = await fetch(proxyRequest);
      
      if (response.ok) {
        return response;
      }
      
      throw new Error(`Proxy returned ${response.status}: ${response.statusText}`);
      
    } catch (error) {
      console.warn(`CORS proxy ${currentProxyIndex} failed:`, error.message);
      currentProxyIndex = (currentProxyIndex + 1) % CORS_PROXIES.length;
      
      if (attempt === maxRetries - 1) {
        throw new Error(`All CORS proxies failed. Last error: ${error.message}`);
      }
    }
  }
}

// More efficient cache quota enforcement with proper error handling
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
    
    if (totalSize === 0 && keys.length > 0) {
      const items = [];
      
      for (let i = 0; i < keys.length; i += 10) {
        const batch = keys.slice(i, i + 10);
        const batchPromises = batch.map(async (key) => {
          try {
            const response = await cache.match(key);
            if (response) {
              const blob = await response.blob();
              return { key, size: blob.size, lastAccessed: response.headers.get('sw-last-accessed') || '0' };
            }
            return null;
          } catch (e) {
            try {
              await cache.delete(key);
            } catch (deleteError) {
              console.warn('Failed to delete corrupted cache entry:', deleteError);
            }
            return null;
          }
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        const validItems = batchResults
          .filter(result => result.status === 'fulfilled' && result.value !== null)
          .map(result => result.value);
        items.push(...validItems);
      }
      
      totalSize = items.reduce((sum, item) => sum + item.size, 0);
      cacheSizes[cacheName] = totalSize;
      lastCacheSizeUpdate = now;
      
      if (totalSize <= limit) return;
      
      items.sort((a, b) => parseInt(a.lastAccessed) - parseInt(b.lastAccessed));
      
      while (totalSize > limit && items.length > 0) {
        const item = items.shift();
        try {
          await cache.delete(item.key);
          totalSize -= item.size;
        } catch (deleteError) {
          console.warn('Failed to delete cache item during quota enforcement:', deleteError);
        }
      }
      
      cacheSizes[cacheName] = totalSize;
    }
  } catch (error) {
    console.error('Cache quota enforcement failed:', error);
    cacheSizes[cacheName] = 0;
  }
}

// Position smoothing function with enhanced stability
function smoothPosition(newPosition) {
  const now = Date.now();
  
  if (!newPosition || typeof newPosition.lat !== 'number' || typeof newPosition.lng !== 'number') {
    return null;
  }
  
  positionBuffer.push({
    ...newPosition,
    timestamp: now
  });
  
  while (positionBuffer.length > 0 && 
         now - positionBuffer[0].timestamp > MAX_POSITION_AGE) {
    positionBuffer.shift();
  }
  
  while (positionBuffer.length > MAX_POSITION_BUFFER_SIZE) {
    positionBuffer.shift();
  }
  
  if (positionBuffer.length < 2) {
    return newPosition;
  }
  
  let totalWeight = 0;
  let smoothedLat = 0;
  let smoothedLng = 0;
  let smoothedAccuracy = 0;
  
  for (let i = 0; i < positionBuffer.length; i++) {
    const position = positionBuffer[i];
    const age = now - position.timestamp;
    const weight = Math.exp(-age / 5000);
    
    smoothedLat += position.lat * weight;
    smoothedLng += position.lng * weight;
    smoothedAccuracy += (position.accuracy || 20) * weight;
    totalWeight += weight;
  }
  
  if (totalWeight > 0) {
    smoothedLat /= totalWeight;
    smoothedLng /= totalWeight;
    smoothedAccuracy /= totalWeight;
  }
  
  const mostRecent = positionBuffer[positionBuffer.length - 1];
  const finalLat = mostRecent.lat * (1 - POSITION_SMOOTHING_FACTOR) + smoothedLat * POSITION_SMOOTHING_FACTOR;
  const finalLng = mostRecent.lng * (1 - POSITION_SMOOTHING_FACTOR) + smoothedLng * POSITION_SMOOTHING_FACTOR;
  
  return {
    lat: finalLat,
    lng: finalLng,
    accuracy: Math.min(mostRecent.accuracy || 20, smoothedAccuracy),
    timestamp: now,
    speed: mostRecent.speed || 0,
    heading: mostRecent.heading || null
  };
}

// Enhanced geolocation request handling
async function handleGeolocationRequest(request) {
  try {
    const url = new URL(request.url);
    const cacheKey = url.pathname + url.search;
    
    const cached = geolocationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GEOLOCATION_CACHE_TTL) {
      return new Response(JSON.stringify(cached.position), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    }
    
    const response = await fetch(request);
    if (!response.ok) {
      return response;
    }
    
    const positionData = await response.json();
    const smoothedPosition = smoothPosition(positionData.coords || positionData);
    
    if (!smoothedPosition) {
      return new Response('{"error": "Invalid location data"}', {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const smoothedResponse = {
      ...positionData,
      coords: smoothedPosition
    };
    
    geolocationCache.set(cacheKey, {
      position: smoothedResponse,
      timestamp: Date.now()
    });
    
    while (geolocationCache.size > 20) {
      const oldestKey = geolocationCache.keys().next().value;
      geolocationCache.delete(oldestKey);
    }
    
    return new Response(JSON.stringify(smoothedResponse), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Geolocation request failed:', error);
    return new Response('{"error": "Location unavailable"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Robust cache-first with request deduplication
async function cacheFirst(req, cacheName) {
  const url = req.url;
  
  if (inFlightRequests.has(url)) {
    return inFlightRequests.get(url);
  }
  
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    
    if (hit) {
      cacheHitCount++;
      
      try {
        const response = hit.clone();
        response.headers.set('sw-last-accessed', Date.now().toString());
        await cache.put(req, response);
      } catch (updateError) {
        console.warn('Failed to update cache timestamp:', updateError);
      }
      
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
            if (!isNaN(size)) {
              cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
              
              if (Date.now() - lastCacheSizeUpdate > CACHE_SIZE_UPDATE_INTERVAL) {
                enforceCacheQuota(cacheName).catch(err => 
                  console.warn('Cache quota enforcement failed:', err));
              }
            }
          }
        } catch (cacheError) {
          console.warn('Failed to cache response:', cacheError);
        }
      }
      return resp;
    }).catch(fetchError => {
      console.warn('Network fetch failed:', fetchError);
      return cache.match(req).then(fallback => 
        fallback || new Response('Resource unavailable', { status: 503 }));
    }).finally(() => {
      inFlightRequests.delete(url);
    });
    
    inFlightRequests.set(url, fetchPromise);
    return fetchPromise;
  } catch (error) {
    console.error('Cache-first strategy failed:', error);
    inFlightRequests.delete(url);
    
    try {
      const fallback = await caches.match(req);
      return fallback || new Response('Resource unavailable', { status: 503 });
    } catch (fallbackError) {
      return new Response('Service unavailable', { status: 503 });
    }
  }
}

// Enhanced stale-while-revalidate for map tiles
async function staleWhileRevalidate(req, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    
    if (cached) {
      cacheHitCount++;
      
      try {
        const response = cached.clone();
        response.headers.set('sw-last-accessed', Date.now().toString());
        await cache.put(req, response);
      } catch (updateError) {
        console.warn('Failed to update cache timestamp:', updateError);
      }
      
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
                if (!isNaN(size)) {
                  cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
                }
              }
              
              preloadAdjacentTiles(req.url, cacheName).catch(err => 
                console.warn('Tile preloading failed:', err));
            } catch (cacheError) {
              console.warn('Background tile update failed:', cacheError);
            }
          }
        }).catch(fetchError => {
          console.warn('Background tile fetch failed:', fetchError);
        }).finally(() => {
          activeBackgroundUpdates--;
        });
      }
      
      return cached;
    }
    
    cacheMissCount++;
    const resp = await fetch(req);
    
    if (resp.ok && resp.status < 400) {
      try {
        const responseClone = resp.clone();
        responseClone.headers.set('sw-last-accessed', Date.now().toString());
        await cache.put(req, responseClone);
        
        const contentLength = resp.headers.get('content-length');
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (!isNaN(size)) {
            cacheSizes[cacheName] = (cacheSizes[cacheName] || 0) + size;
          }
        }
        
        preloadAdjacentTiles(req.url, cacheName).catch(err => 
          console.warn('Tile preloading failed:', err));
      } catch (cacheError) {
        console.warn('Failed to cache new tile:', cacheError);
      }
    }
    
    return resp;
  } catch (error) {
    console.error('Stale-while-revalidate failed:', error);
    return new Response('Tile unavailable', { status: 503 });
  }
}

// Intelligent adjacent tile preloading
async function preloadAdjacentTiles(tileUrl, cacheName) {
  try {
    const url = new URL(tileUrl);
    const pathParts = url.pathname.split('/').filter(part => part);
    
    if (pathParts.length < 3) return;
    
    const z = parseInt(pathParts[pathParts.length - 3]);
    const x = parseInt(pathParts[pathParts.length - 2]);
    const y = parseInt(pathParts[pathParts.length - 1].split('.')[0]);
    
    if (isNaN(z) || isNaN(x) || isNaN(y)) return;
    
    const adjacentTiles = [
      [z, x - 1, y - 1], [z, x, y - 1], [z, x + 1, y - 1],
      [z, x - 1, y],                   [z, x + 1, y],
      [z, x - 1, y + 1], [z, x, y + 1], [z, x + 1, y + 1]
    ];
    
    if (activeBackgroundUpdates < MAX_CONCURRENT_BACKGROUND_UPDATES - 1) {
      const cache = await caches.open(cacheName);
      
      for (const [tileZ, tileX, tileY] of adjacentTiles) {
        if (tileX >= 0 && tileY >= 0 && tileX < Math.pow(2, tileZ) && tileY < Math.pow(2, tileZ)) {
          const adjacentUrl = `${url.origin}${url.pathname.substring(0, url.pathname.lastIndexOf('/'))}/../${tileZ}/${tileX}/${tileY}.png`;
          
          try {
            const cached = await cache.match(adjacentUrl);
            if (!cached) {
              fetch(adjacentUrl).then(resp => {
                if (resp.ok) {
                  cache.put(adjacentUrl, resp).catch(err => 
                    console.warn('Failed to cache adjacent tile:', err));
                }
              }).catch(() => {
                // Silent fail for preloading
              });
            }
          } catch (preloadError) {
            // Silent fail for individual tile preloading
          }
        }
      }
    }
  } catch (error) {
    console.warn('Failed to preload adjacent tiles:', error);
  }
}

// Enhanced audio handling with robust CORS proxy and range support
async function networkFirstForAudioRange(req) {
  try {
    const originalUrl = req.url;
    const isRangeRequest = req.headers.get('range');
    
    if (isRangeRequest) {
      try {
        const proxyResponse = await fetchWithCORSProxy(originalUrl, {
          method: req.method,
          headers: req.headers
        });
        
        if (proxyResponse.ok) {
          return proxyResponse;
        }
      } catch (proxyError) {
        console.warn('CORS proxy failed for range request:', proxyError);
      }
      
      try {
        const cached = await caches.match(new Request(originalUrl, { method: 'GET' }));
        if (cached) {
          const blob = await cached.blob();
          const rangeHeader = req.headers.get('range');
          const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : blob.size - 1;
            const slicedBlob = blob.slice(start, end + 1);
            
            return new Response(slicedBlob, {
              status: 206,
              statusText: 'Partial Content',
              headers: {
                'Content-Range': `bytes ${start}-${end}/${blob.size}`,
                'Content-Length': slicedBlob.size.toString(),
                'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg'
              }
            });
          }
        }
      } catch (rangeError) {
        console.warn('Range request fallback failed:', rangeError);
      }
    }
    
    try {
      const cache = await caches.open(CACHE_VERSIONS.AUDIO);
      const fullReq = new Request(originalUrl, { method: 'GET' });
      const cached = await cache.match(fullReq);
      
      if (cached) {
        return cached;
      }
      
      const directResponse = await fetch(fullReq);
      if (directResponse.ok) {
        try {
          const responseClone = directResponse.clone();
          responseClone.headers.set('sw-last-accessed', Date.now().toString());
          await cache.put(fullReq, responseClone);
          enforceCacheQuota(CACHE_VERSIONS.AUDIO).catch(err => 
            console.warn('Audio cache quota enforcement failed:', err));
        } catch (cacheError) {
          console.warn('Failed to cache audio file:', cacheError);
        }
        return directResponse;
      }
      
      const proxyResponse = await fetchWithCORSProxy(originalUrl);
      if (proxyResponse.ok) {
        try {
          const responseClone = proxyResponse.clone();
          responseClone.headers.set('sw-last-accessed', Date.now().toString());
          await cache.put(fullReq, responseClone);
          enforceCacheQuota(CACHE_VERSIONS.AUDIO).catch(err => 
            console.warn('Audio cache quota enforcement failed:', err));
        } catch (cacheError) {
          console.warn('Failed to cache proxied audio file:', cacheError);
        }
        return proxyResponse;
      }
      
    } catch (audioError) {
      console.warn('Audio handling failed:', audioError);
    }
    
    return new Response('Audio unavailable', { status: 503 });
  } catch (error) {
    console.error('Audio range request failed:', error);
    return new Response('Audio service error', { status: 500 });
  }
}

// Enhanced fetch event handler with better error handling
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  try {
    if (url.endsWith('/manifest.json')) {
      event.respondWith(fetch(event.request));
      return;
    }
    
    if (url.includes('geolocation') || url.includes('location')) {
      event.respondWith(handleGeolocationRequest(event.request));
      return;
    }
    
    if (url.includes('/tiles/') || 
        url.match(/\.(png|jpg|jpeg)$/i) && (url.includes('tile') || url.includes('map'))) {
      event.respondWith(staleWhileRevalidate(event.request, CACHE_VERSIONS.TILES));
      return;
    }
    
    if (url.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i)) {
      event.respondWith(cacheFirst(event.request, CACHE_VERSIONS.IMAGES));
      return;
    }
    
    if (url.match(/\.(css|js)$/i)) {
      event.respondWith(cacheFirst(event.request, CACHE_VERSIONS.STATIC));
      return;
    }
    
    if (url.includes('audio') || url.match(/\.(mp3|wav|ogg|m4a)$/i)) {
      event.respondWith(networkFirstForAudioRange(event.request));
      return;
    }
    
    event.respondWith(
      fetch(event.request).catch(() => 
        caches.match(event.request).then(cached => 
          cached || new Response('Service unavailable', { status: 503 })))
    );
  } catch (error) {
    console.error('Fetch event handler error:', error);
    event.respondWith(new Response('Service error', { status: 500 }));
  }
});

// Enhanced message handling
self.addEventListener('message', (event) => {
  try {
    if (!event.data || !event.data.type) return;
    
    switch (event.data.type) {
      case 'GET_CACHE_STATS':
        const totalRequests = cacheHitCount + cacheMissCount;
        const hitRate = totalRequests > 0 ? (cacheHitCount / totalRequests * 100) : 0;
        
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({
            cacheHits: cacheHitCount,
            cacheMisses: cacheMissCount,
            hitRate: parseFloat(hitRate.toFixed(2)),
            activeBackgroundUpdates: activeBackgroundUpdates,
            cacheSizes: { ...cacheSizes },
            positionBufferSize: positionBuffer.length,
            currentProxyIndex: currentProxyIndex
          });
        }
        break;
        
      case 'CLEAR_CACHE':
        const cacheName = event.data.cacheName;
        if (cacheName && Object.values(CACHE_VERSIONS).includes(cacheName)) {
          caches.delete(cacheName).then(() => {
            cacheSizes[cacheName] = 0;
            if (event.ports && event.ports[0]) {
              event.ports[0].postMessage({ success: true });
            }
          }).catch(error => {
            console.error('Failed to clear cache:', error);
            if (event.ports && event.ports[0]) {
              event.ports[0].postMessage({ success: false, error: error.message });
            }
          });
        }
        break;
        
      case 'RESET_CACHE_SIZES':
        for (const key in cacheSizes) {
          cacheSizes[key] = 0;
        }
        lastCacheSizeUpdate = 0;
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
        break;
        
      case 'CLEAR_POSITION_BUFFER':
        positionBuffer.length = 0;
        geolocationCache.clear();
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
        break;
        
      case 'ROTATE_PROXY':
        currentProxyIndex = (currentProxyIndex + 1) % CORS_PROXIES.length;
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ 
            success: true, 
            currentProxy: CORS_PROXIES[currentProxyIndex] 
          });
        }
        break;
    }
  } catch (error) {
    console.error('Message handler error:', error);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ success: false, error: error.message });
    }
  }
});

// Enhanced error logging
self.addEventListener('error', (event) => {
  console.error('Service Worker Error:', {
    message: event.error?.message || 'Unknown error',
    stack: event.error?.stack || 'No stack trace',
    filename: event.filename || 'Unknown file',
    lineno: event.lineno || 'Unknown line',
    colno: event.colno || 'Unknown column',
    stats: {
      cacheHits: cacheHitCount,
      cacheMisses: cacheMissCount,
      activeBackgroundUpdates: activeBackgroundUpdates,
      positionBufferSize: positionBuffer.length,
      currentProxyIndex: currentProxyIndex
    }
  });
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker Unhandled Promise Rejection:', {
    reason: event.reason?.message || event.reason || 'Unknown reason',
    stack: event.reason?.stack || 'No stack trace',
    stats: {
      cacheHits: cacheHitCount,
      cacheMisses: cacheMissCount,
      activeBackgroundUpdates: activeBackgroundUpdates,
      positionBufferSize: positionBuffer.length,
      currentProxyIndex: currentProxyIndex
    }
  });
  
  event.preventDefault();
});

// Robust cache cleanup on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.resolve().then(async () => {
      try {
        const cacheNames = await caches.keys();
        
        await Promise.allSettled(
          cacheNames.map(async (cacheName) => {
            if (!Object.values(CACHE_VERSIONS).includes(cacheName)) {
              console.log('Deleting old cache:', cacheName);
              try {
                await caches.delete(cacheName);
              } catch (deleteError) {
                console.warn('Failed to delete old cache:', cacheName, deleteError);
              }
            } else {
              cacheSizes[cacheName] = 0;
            }
          })
        );
        
        await self.clients.claim();
      } catch (error) {
        console.error('Activation error:', error);
      }
    })
  );
});

// Robust installation with graceful failure handling
self.addEventListener('install', (event) => {
  const criticalResources = [
    '/',
    '/placeholder.svg'
  ];
  
  const optionalResources = [
    '/index.html',
    '/manifest.json'
  ];
  
  event.waitUntil(
    Promise.resolve().then(async () => {
      try {
        const cache = await caches.open(CACHE_VERSIONS.STATIC);
        
        // Cache critical resources first with individual error handling
        const criticalPromises = criticalResources.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) {
              const responseClone = response.clone();
              responseClone.headers.set('sw-last-accessed', Date.now().toString());
              await cache.put(url, responseClone);
              console.log('Cached critical resource:', url);
            } else {
              console.warn(`Critical resource ${url} returned status: ${response.status}`);
            }
          } catch (error) {
            console.warn(`Failed to cache critical resource ${url}:`, error.message);
            // Don't throw to avoid failing the entire installation
          }
        });
        
        await Promise.allSettled(criticalPromises);
        
        // Cache optional resources without failing installation
        const optionalPromises = optionalResources.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) {
              const responseClone = response.clone();
              responseClone.headers.set('sw-last-accessed', Date.now().toString());
              await cache.put(url, responseClone);
              console.log('Cached optional resource:', url);
            }
          } catch (error) {
            console.warn(`Failed to cache optional resource ${url}:`, error.message);
          }
        });
        
        await Promise.allSettled(optionalPromises);
        
        console.log('Service Worker 3.6.0: Installation completed with enhanced error handling');
      } catch (error) {
        console.error('Installation failed:', error);
        throw error;
      }
    })
  );
  
  self.skipWaiting();
});

console.log('Service Worker 3.6.0: Enhanced with robust CORS proxy and error handling');
