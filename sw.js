const CACHE_NAME = 'mnthen-v5';
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
const LOCATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/images/logo.webp',
  '/images/mnthenfav.ico',
  '/images/splash_screen.webp',
  '/placeholder.svg',
  '/manifest.json'
];

// Enhanced cache strategies
const STRATEGIES = {
  PRECACHE: 'precache',
  NETWORK_FIRST: 'network-first',
  CACHE_FIRST: 'cache-first',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
  NETWORK_ONLY: 'network-only',
  CACHE_ONLY: 'cache-only'
};

// In-flight request tracking to prevent cache stampedes
const inFlightRequests = new Map();

// Performance metrics
const metrics = {
  cacheHits: 0,
  cacheMisses: 0,
  networkRequests: 0,
  errors: 0,
  averageResponseTime: 0,
  lastUpdated: Date.now()
};

self.addEventListener('install', (event) => {
  console.log('[SW] Installing version', CACHE_NAME);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Precaching resources');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        console.log('[SW] Precaching complete');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[SW] Precaching failed:', error);
        metrics.errors++;
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version', CACHE_NAME);
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      )),
      // Initialize cache management
      cleanupExpiredCache(),
      // Take control of all clients
      self.clients.claim()
    ]).then(() => {
      console.log('[SW] Activation complete');
      // Notify clients about activation
      broadcastMessage({ type: 'SW_ACTIVATED', cacheName: CACHE_NAME });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests, chrome-extension URLs, and hot reload requests
  if (
    request.method !== 'GET' || 
    url.protocol === 'chrome-extension:' ||
    url.pathname.includes('__vite_ping') ||
    url.searchParams.has('t') // Vite HMR timestamp
  ) {
    return;
  }

  // Enhanced strategy determination
  const strategy = determineStrategy(request, url);
  
  event.respondWith(
    handleRequestWithMetrics(event, strategy)
      .catch(error => {
        console.error('[SW] Request failed:', error);
        metrics.errors++;
        return handleRequestError(request, error);
      })
  );
});

function determineStrategy(request, url) {
  // Security check for same-origin requests
  if (url.origin !== location.origin && !isTrustedOrigin(url.origin)) {
    return STRATEGIES.NETWORK_ONLY;
  }

  if (PRECACHE_URLS.includes(url.pathname)) {
    return STRATEGIES.PRECACHE;
  }
  
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/locations')) {
      return STRATEGIES.NETWORK_FIRST;
    }
    // Critical API endpoints should always be fresh
    if (url.pathname.includes('/auth') || url.pathname.includes('/payment')) {
      return STRATEGIES.NETWORK_ONLY;
    }
    return STRATEGIES.NETWORK_FIRST;
  }
  
  // Enhanced media file handling
  if (url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i)) {
    return STRATEGIES.CACHE_FIRST;
  }
  
  if (url.pathname.match(/\.(mp3|ogg|wav|mp4|webm)$/i)) {
    return STRATEGIES.STALE_WHILE_REVALIDATE;
  }
  
  // CSS and JS files
  if (url.pathname.match(/\.(css|js|woff2?|ttf|eot)$/i)) {
    return STRATEGIES.STALE_WHILE_REVALIDATE;
  }
  
  // HTML pages
  if (request.headers.get('accept')?.includes('text/html')) {
    return STRATEGIES.NETWORK_FIRST;
  }
  
  return STRATEGIES.NETWORK_FIRST;
}

function isTrustedOrigin(origin) {
  const trustedOrigins = [
    'https://api.mnthen.com',
    'https://cdn.mnthen.com',
    'https://images.unsplash.com',
    'https://via.placeholder.com'
  ];
  return trustedOrigins.includes(origin);
}

async function handleRequestWithMetrics(event, strategy) {
  const startTime = performance.now();
  const response = await handleRequest(event, strategy);
  const endTime = performance.now();
  
  // Update metrics
  updateMetrics(response, endTime - startTime);
  
  return response;
}

async function handleRequest(event, strategy) {
  const { request } = event;
  const cache = await caches.open(CACHE_NAME);
  const requestKey = `${request.method}:${request.url}`;

  // Prevent concurrent identical requests (cache stampede protection)
  if (inFlightRequests.has(requestKey)) {
    return inFlightRequests.get(requestKey);
  }

  let responsePromise;

  switch (strategy) {
    case STRATEGIES.PRECACHE:
      responsePromise = handlePrecache(request, cache);
      break;
    case STRATEGIES.CACHE_FIRST:
      responsePromise = handleCacheFirst(request, cache, event);
      break;
    case STRATEGIES.NETWORK_FIRST:
      responsePromise = handleNetworkFirst(request, cache, event);
      break;
    case STRATEGIES.STALE_WHILE_REVALIDATE:
      responsePromise = handleStaleWhileRevalidate(request, cache, event);
      break;
    case STRATEGIES.NETWORK_ONLY:
      responsePromise = fetchWithRetry(request);
      break;
    case STRATEGIES.CACHE_ONLY:
      responsePromise = cache.match(request);
      break;
    default:
      responsePromise = handleNetworkFirst(request, cache, event);
  }

  // Store the promise to prevent duplicate requests
  inFlightRequests.set(requestKey, responsePromise);
  
  // Clean up after completion
  responsePromise.finally(() => {
    inFlightRequests.delete(requestKey);
  });

  return responsePromise;
}

async function handlePrecache(request, cache) {
  const response = await cache.match(request);
  if (response) {
    metrics.cacheHits++;
    return addSecurityHeaders(response);
  }
  metrics.cacheMisses++;
  throw new Error('Precached resource not found');
}

async function handleCacheFirst(request, cache, event) {
  const cachedResponse = await cache.match(request);
  if (cachedResponse && !isResponseStale(cachedResponse)) {
    metrics.cacheHits++;
    return addSecurityHeaders(cachedResponse);
  }

  try {
    const networkResponse = await fetchWithRetry(request);
    if (networkResponse && networkResponse.ok) {
      event.waitUntil(
        cacheResponse(cache, request, networkResponse.clone())
      );
    }
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    if (cachedResponse) {
      console.log('[SW] Serving stale cache due to network error');
      metrics.cacheHits++;
      return addSecurityHeaders(cachedResponse);
    }
    throw error;
  }
}

async function handleNetworkFirst(request, cache, event) {
  try {
    const networkResponse = await fetchWithRetry(request);
    if (networkResponse && networkResponse.ok) {
      event.waitUntil(
        Promise.all([
          cacheResponse(cache, request, networkResponse.clone()),
          cleanupExpiredCache()
        ])
      );
    }
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      console.log('[SW] Serving cache due to network error');
      metrics.cacheHits++;
      return addSecurityHeaders(cachedResponse);
    }
    throw error;
  }
}

async function handleStaleWhileRevalidate(request, cache, event) {
  const cachedResponse = await cache.match(request);
  
  // Background update
  const fetchPromise = fetchWithRetry(request)
    .then(networkResponse => {
      if (networkResponse && networkResponse.ok) {
        return cacheResponse(cache, request, networkResponse.clone());
      }
    })
    .catch(error => {
      console.log('[SW] Background update failed:', error);
    });

  event.waitUntil(fetchPromise);

  if (cachedResponse) {
    metrics.cacheHits++;
    return addSecurityHeaders(cachedResponse);
  }

  // If no cached response, wait for network
  try {
    const networkResponse = await fetchPromise;
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    throw error;
  }
}

async function fetchWithRetry(request, retryCount = 0) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(request, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok && response.status >= 500 && retryCount < MAX_RETRY_ATTEMPTS) {
      console.log(`[SW] Retrying request (${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
      return fetchWithRetry(request, retryCount + 1);
    }
    
    return response;
  } catch (error) {
    if (retryCount < MAX_RETRY_ATTEMPTS && error.name !== 'AbortError') {
      console.log(`[SW] Retrying request after error (${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
      return fetchWithRetry(request, retryCount + 1);
    }
    throw error;
  }
}

async function cacheResponse(cache, request, response) {
  // Don't cache responses with errors or no-cache headers
  if (!response.ok || 
      response.headers.get('cache-control')?.includes('no-cache') ||
      response.headers.get('cache-control')?.includes('no-store')) {
    return;
  }

  // Add timestamp for cache management
  const headers = new Headers(response.headers);
  headers.set('sw-cached-at', Date.now().toString());
  headers.set('sw-cache-version', CACHE_NAME);

  const modifiedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });

  await cache.put(request, modifiedResponse);
}

function addSecurityHeaders(response) {
  if (!response) return response;
  
  const headers = new Headers(response.headers);
  
  // Add security headers if not present
  if (!headers.has('X-Content-Type-Options')) {
    headers.set('X-Content-Type-Options', 'nosniff');
  }
  if (!headers.has('X-Frame-Options')) {
    headers.set('X-Frame-Options', 'DENY');
  }
  if (!headers.has('Referrer-Policy')) {
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isResponseStale(response, maxAge = LOCATION_CACHE_TTL) {
  const cachedAt = response.headers.get('sw-cached-at');
  if (!cachedAt) return true;
  
  const cacheTime = parseInt(cachedAt);
  return Date.now() - cacheTime > maxAge;
}

async function handleRequestError(request, error) {
  console.error('[SW] Request error:', error);
  
  if (request.headers.get('accept')?.includes('text/html')) {
    const offlineResponse = await caches.match('/offline.html');
    if (offlineResponse) {
      return offlineResponse;
    }
  }
  
  return new Response(
    JSON.stringify({ 
      error: 'Service unavailable', 
      message: 'Please check your connection and try again' 
    }), 
    { 
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// Enhanced cache management
async function cleanupExpiredCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const now = Date.now();
    
    const cleanupPromises = keys.map(async request => {
      try {
        const url = new URL(request.url);
        
        // Location-specific cleanup
        if (url.pathname.startsWith('/api/locations')) {
          const response = await cache.match(request);
          if (response && isResponseStale(response, LOCATION_CACHE_TTL)) {
            console.log('[SW] Removing expired location cache:', url.pathname);
            return cache.delete(request);
          }
        }
        
        // General cache cleanup based on headers
        const response = await cache.match(request);
        if (response) {
          const maxAge = getCacheMaxAge(response);
          if (maxAge && isResponseStale(response, maxAge)) {
            console.log('[SW] Removing expired cache:', url.pathname);
            return cache.delete(request);
          }
        }
      } catch (error) {
        console.error('[SW] Cleanup error for request:', request.url, error);
      }
    });

    await Promise.allSettled(cleanupPromises);
    
    // Enforce size limits
    await enforceCacheSizeLimit();
    
    console.log('[SW] Cache cleanup complete');
  } catch (error) {
    console.error('[SW] Cache cleanup failed:', error);
  }
}

function getCacheMaxAge(response) {
  const cacheControl = response.headers.get('cache-control');
  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      return parseInt(maxAgeMatch[1]) * 1000; // Convert to milliseconds
    }
  }
  return null;
}

async function enforceCacheSizeLimit() {
  const currentSize = await getCacheSize();
  if (currentSize > MAX_CACHE_SIZE) {
    console.log(`[SW] Cache size (${formatBytes(currentSize)}) exceeds limit, trimming...`);
    await trimCache(currentSize - MAX_CACHE_SIZE);
  }
}

async function getCacheSize() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  let size = 0;

  await Promise.all(keys.map(async request => {
    try {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        size += blob.size;
      }
    } catch (error) {
      console.error('[SW] Error calculating cache size for:', request.url);
    }
  }));

  return size;
}

async function trimCache(bytesToRemove) {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const entries = [];

  await Promise.all(keys.map(async request => {
    try {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        const cachedAt = response.headers.get('sw-cached-at') || Date.now();
        entries.push({
          request,
          size: blob.size,
          cachedAt: parseInt(cachedAt),
          isPrecached: PRECACHE_URLS.includes(new URL(request.url).pathname)
        });
      }
    } catch (error) {
      console.error('[SW] Error processing cache entry:', request.url);
    }
  }));

  // Sort by priority: non-precached first, then by age (oldest first)
  entries.sort((a, b) => {
    if (a.isPrecached !== b.isPrecached) {
      return a.isPrecached ? 1 : -1;
    }
    return a.cachedAt - b.cachedAt;
  });

  let bytesFreed = 0;
  for (const entry of entries) {
    if (bytesFreed >= bytesToRemove) break;
    if (!entry.isPrecached) { // Don't remove precached files
      await cache.delete(entry.request);
      bytesFreed += entry.size;
      console.log('[SW] Removed from cache:', entry.request.url);
    }
  }

  console.log(`[SW] Freed ${formatBytes(bytesFreed)} from cache`);
}

function updateMetrics(response, responseTime) {
  if (response) {
    if (response.headers.get('sw-cached-at')) {
      metrics.cacheHits++;
    } else {
      metrics.networkRequests++;
    }
  }
  
  // Update average response time (simple moving average)
  const totalRequests = metrics.cacheHits + metrics.networkRequests;
  metrics.averageResponseTime = 
    (metrics.averageResponseTime * (totalRequests - 1) + responseTime) / totalRequests;
  
  metrics.lastUpdated = Date.now();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Message handling
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};
  
  switch (type) {
    case 'PREFETCH_LOCATIONS':
      event.waitUntil(prefetchLocationData(data.locations));
      break;
      
    case 'GET_METRICS':
      event.ports[0]?.postMessage({ type: 'METRICS', data: metrics });
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(clearCache());
      break;
      
    case 'UPDATE_CACHE':
      event.waitUntil(updateCache());
      break;
  }
});

function broadcastMessage(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => client.postMessage(message));
  });
}

async function prefetchLocationData(locations) {
  if (!Array.isArray(locations)) return;
  
  console.log(`[SW] Prefetching ${locations.length} locations`);
  const cache = await caches.open(CACHE_NAME);
  const now = Date.now().toString();
  
  const results = await Promise.allSettled(locations.map(async location => {
    try {
      // Prefetch location data
      const locationUrl = `/api/locations/${location.id}`;
      const locationResponse = await fetchWithRetry(new Request(locationUrl));
      if (locationResponse && locationResponse.ok) {
        await cacheResponse(cache, new Request(locationUrl), locationResponse);
      }

      // Prefetch location images
      if (location.imageUrl) {
        const imageResponse = await fetchWithRetry(new Request(location.imageUrl));
        if (imageResponse && imageResponse.ok) {
          await cacheResponse(cache, new Request(location.imageUrl), imageResponse);
        }
      }
      
      return { success: true, location: location.id };
    } catch (error) {
      console.error('[SW] Prefetch failed for location:', location.id, error);
      return { success: false, location: location.id, error: error.message };
    }
  }));

  const successful = results.filter(r => r.value?.success).length;
  console.log(`[SW] Prefetch complete: ${successful}/${locations.length} successful`);
  
  await cleanupExpiredCache();
  
  broadcastMessage({ 
    type: 'PREFETCH_COMPLETE', 
    data: { successful, total: locations.length } 
  });
}

async function clearCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  
  // Keep precached files
  const nonPrecachedKeys = keys.filter(request => {
    const url = new URL(request.url);
    return !PRECACHE_URLS.includes(url.pathname);
  });
  
  await Promise.all(nonPrecachedKeys.map(key => cache.delete(key)));
  
  console.log(`[SW] Cleared ${nonPrecachedKeys.length} cached items`);
  broadcastMessage({ type: 'CACHE_CLEARED' });
}

async function updateCache() {
  // Force update of precached resources
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(PRECACHE_URLS.map(async url => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) {
        await cache.put(url, response);
      }
    } catch (error) {
      console.error('[SW] Failed to update cached resource:', url, error);
    }
  }));
  
  console.log('[SW] Cache update complete');
  broadcastMessage({ type: 'CACHE_UPDATED' });
}

console.log('[SW] Service Worker loaded');
