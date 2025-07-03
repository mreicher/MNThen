const CACHE_NAME = 'mnthen-enterprise-v6';
const MAX_CACHE_SIZE = 150 * 1024 * 1024; // 150MB
const LOCATION_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
const AUDIO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 week
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE = 1000;
const NETWORK_TIMEOUT = 15000;

// Enhanced precache list with versioning
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/images/logo.webp',
  '/images/mnthenfav.ico',
  '/images/splash_screen.webp',
  '/images/social-share.jpg',
  '/placeholder.svg',
  '/manifest.json',
  '/locations_main.js'
].map(url => `${url}?v=6`);

// Cache strategies
const STRATEGIES = {
  PRECACHE: 'precache',
  CRITICAL: 'critical',
  API_DATA: 'api-data',
  MEDIA: 'media',
  FALLBACK: 'fallback'
};

// Enhanced trusted origins
const TRUSTED_ORIGINS = [
  self.location.origin,
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://cdnjs.cloudflare.com',
  'https://tile.openstreetmap.org',
  'https://api.mnthen.com'
];

// Track in-flight requests to prevent duplicates
const inFlightRequests = new Map();

// Simplified metrics
const metrics = {
  cacheHits: 0,
  cacheMisses: 0,
  networkRequests: 0,
  errors: 0,
  prefetches: 0,
  startTime: Date.now(),
  lastUpdated: Date.now()
};

// Simplified cache manager
class CacheManager {
  constructor() {
    this.currentSize = 0;
  }
  
  async calculateSize() {
    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      
      this.currentSize = 0;
      for (const request of keys) {
        try {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            this.currentSize += blob.size;
          }
        } catch (error) {
          console.warn('[SW] Error calculating cache size for:', request.url);
        }
      }
      
      return this.currentSize;
    } catch (error) {
      console.error('[SW] Error calculating total cache size:', error);
      return 0;
    }
  }
  
  async purgeOldEntries(targetSize = MAX_CACHE_SIZE * 0.2) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      const entries = [];
      
      // Collect entries with timestamps
      for (const request of keys) {
        try {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            const cachedAt = response.headers.get('sw-cached-at') || '0';
            const isPrecached = PRECACHE_URLS.some(url => request.url.includes(url.split('?')[0]));
            
            if (!isPrecached) {
              entries.push({
                request,
                size: blob.size,
                cachedAt: parseInt(cachedAt),
                url: request.url
              });
            }
          }
        } catch (error) {
          console.warn('[SW] Error processing cache entry:', request.url);
        }
      }
      
      // Sort by oldest first
      entries.sort((a, b) => a.cachedAt - b.cachedAt);
      
      let bytesFreed = 0;
      for (const entry of entries) {
        if (bytesFreed >= targetSize) break;
        
        try {
          await cache.delete(entry.request);
          bytesFreed += entry.size;
          console.log(`[SW] Purged: ${entry.url} (${entry.size} bytes)`);
        } catch (error) {
          console.warn('[SW] Error deleting cache entry:', entry.url);
        }
      }
      
      this.currentSize = Math.max(0, this.currentSize - bytesFreed);
      return bytesFreed;
    } catch (error) {
      console.error('[SW] Error during cache purge:', error);
      return 0;
    }
  }
}

const cacheManager = new CacheManager();

// Install event
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Enterprise SW version', CACHE_NAME);
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        
        // Precache files one by one to avoid overwhelming the system
        for (const url of PRECACHE_URLS) {
          try {
            await cache.add(url);
          } catch (error) {
            console.warn('[SW] Failed to precache:', url, error.message);
          }
        }
        
        console.log('[SW] Precaching complete');
        await self.skipWaiting();
      } catch (error) {
        console.error('[SW] Install failed:', error);
      }
    })()
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Enterprise SW');
  
  event.waitUntil(
    (async () => {
      try {
        // Clean up old caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(name => {
            if (name !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            }
          })
        );
        
        // Initialize cache management
        await cacheManager.calculateSize();
        
        // Claim clients
        await self.clients.claim();
        
        console.log('[SW] Activation complete');
        broadcastMessage({ 
          type: 'SW_ACTIVATED', 
          version: CACHE_NAME,
          initialCacheSize: cacheManager.currentSize 
        });
      } catch (error) {
        console.error('[SW] Activation failed:', error);
      }
    })()
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET and non-http(s) requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }
  
  // Skip Vite HMR requests
  if (url.pathname.includes('__vite_ping') || url.searchParams.has('t')) {
    return;
  }
  
  // Skip chrome-extension and other non-web protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }
  
  event.respondWith(
    (async () => {
      try {
        const strategy = determineStrategy(request, url);
        const response = await handleRequest(request, strategy, event);
        
        // Update metrics safely
        updateMetrics(response);
        return response;
      } catch (error) {
        console.error('[SW] Request failed:', error);
        metrics.errors++;
        return handleRequestError(request, error);
      }
    })()
  );
});

function determineStrategy(request, url) {
  // Security: Only cache trusted origins
  if (!TRUSTED_ORIGINS.includes(url.origin)) {
    return STRATEGIES.FALLBACK;
  }
  
  // Check if it's a precached asset
  const isPreCached = PRECACHE_URLS.some(precacheUrl => {
    const cleanUrl = precacheUrl.split('?')[0];
    return url.pathname === cleanUrl;
  });
  
  if (isPreCached) {
    return STRATEGIES.PRECACHE;
  }
  
  // API endpoints
  if (url.pathname.startsWith('/api/')) {
    return url.pathname.includes('/locations') ? STRATEGIES.API_DATA : STRATEGIES.FALLBACK;
  }
  
  // Static assets by extension
  const extension = url.pathname.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'css':
    case 'js':
    case 'woff':
    case 'woff2':
    case 'ttf':
      return STRATEGIES.CRITICAL;
      
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'svg':
    case 'mp3':
    case 'ogg':
    case 'wav':
      return STRATEGIES.MEDIA;
      
    default:
      return STRATEGIES.FALLBACK;
  }
}

async function handleRequest(request, strategy, event) {
  const cache = await caches.open(CACHE_NAME);
  const requestKey = `${request.method}:${request.url}`;
  
  // Check for in-flight requests
  if (inFlightRequests.has(requestKey)) {
    return inFlightRequests.get(requestKey);
  }
  
  let responsePromise;
  
  switch (strategy) {
    case STRATEGIES.PRECACHE:
      responsePromise = handlePrecache(request, cache);
      break;
      
    case STRATEGIES.CRITICAL:
      responsePromise = handleCriticalAssets(request, cache, event);
      break;
      
    case STRATEGIES.API_DATA:
      responsePromise = handleApiData(request, cache);
      break;
      
    case STRATEGIES.MEDIA:
      responsePromise = handleMedia(request, cache, event);
      break;
      
    default:
      responsePromise = handleFallback(request, cache);
  }
  
  // Track in-flight requests
  inFlightRequests.set(requestKey, responsePromise);
  responsePromise.finally(() => inFlightRequests.delete(requestKey));
  
  return responsePromise;
}

async function handlePrecache(request, cache) {
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    metrics.cacheHits++;
    return addSecurityHeaders(cachedResponse);
  }
  
  metrics.cacheMisses++;
  throw new Error('Precached resource not found');
}

async function handleCriticalAssets(request, cache, event) {
  // Try cache first
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    metrics.cacheHits++;
    
    // Update in background if not too recent
    if (isResponseStale(cachedResponse, LOCATION_CACHE_TTL)) {
      event.waitUntil(
        fetchWithRetry(request)
          .then(networkResponse => {
            if (networkResponse?.ok) {
              return cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.CRITICAL);
            }
          })
          .catch(error => console.warn('[SW] Background update failed:', error))
      );
    }
    
    return addSecurityHeaders(cachedResponse);
  }
  
  // Fallback to network
  const networkResponse = await fetchWithRetry(request);
  if (networkResponse.ok) {
    event.waitUntil(
      cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.CRITICAL)
    );
  }
  metrics.networkRequests++;
  return addSecurityHeaders(networkResponse);
}

async function handleApiData(request, cache) {
  // Network first for API data
  try {
    const networkResponse = await fetchWithRetry(request);
    if (networkResponse.ok) {
      // Cache in background
      cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.API_DATA)
        .catch(error => console.warn('[SW] Cache update failed:', error));
    }
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    // Fallback to cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      metrics.cacheHits++;
      return addSecurityHeaders(cachedResponse);
    }
    throw error;
  }
}

async function handleMedia(request, cache, event) {
  // Cache first for media
  const cachedResponse = await cache.match(request);
  if (cachedResponse && !isResponseStale(cachedResponse, AUDIO_CACHE_TTL)) {
    metrics.cacheHits++;
    return addSecurityHeaders(cachedResponse);
  }
  
  // Network with cache update
  try {
    const networkResponse = await fetchWithRetry(request);
    if (networkResponse.ok) {
      event.waitUntil(
        cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.MEDIA)
      );
    }
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    // Return stale cache if available
    if (cachedResponse) {
      metrics.cacheHits++;
      return addSecurityHeaders(cachedResponse);
    }
    throw error;
  }
}

async function handleFallback(request, cache) {
  // Network first
  try {
    const networkResponse = await fetchWithRetry(request);
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    // Try cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      metrics.cacheHits++;
      return addSecurityHeaders(cachedResponse);
    }
    
    // HTML fallback
    if (request.headers.get('accept')?.includes('text/html')) {
      const offlineResponse = await cache.match('/offline.html');
      if (offlineResponse) {
        return offlineResponse;
      }
    }
    
    throw error;
  }
}

async function fetchWithRetry(request, attempt = 1) {
  if (attempt > MAX_RETRY_ATTEMPTS) {
    throw new Error(`Max retries exceeded for ${request.url}`);
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);
  
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok && response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (attempt < MAX_RETRY_ATTEMPTS && (error.name === 'AbortError' || error.message.includes('Server error'))) {
      const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(request, attempt + 1);
    }
    
    throw error;
  }
}

async function cacheResponse(cache, request, response, strategy) {
  if (!response?.ok) return;
  
  try {
    // Check cache control
    const cacheControl = response.headers.get('cache-control') || '';
    if (cacheControl.includes('no-store')) {
      return;
    }
    
    // Check cache size before adding
    if (cacheManager.currentSize > MAX_CACHE_SIZE * 0.8) {
      await cacheManager.purgeOldEntries();
    }
    
    // Prepare response
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', Date.now().toString());
    headers.set('sw-strategy', strategy);
    headers.set('sw-cache-version', CACHE_NAME);
    
    const body = await response.blob();
    cacheManager.currentSize += body.size;
    
    await cache.put(request, new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    }));
  } catch (error) {
    console.warn('[SW] Failed to cache response:', request.url, error.message);
  }
}

function addSecurityHeaders(response) {
  if (!response) return response;
  
  const headers = new Headers(response.headers);
  
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

function updateMetrics(response) {
  try {
    if (response?.headers?.get('sw-cached-at')) {
      metrics.cacheHits++;
    } else {
      metrics.networkRequests++;
    }
    metrics.lastUpdated = Date.now();
  } catch (error) {
    console.warn('[SW] Error updating metrics:', error);
  }
}

function handleRequestError(request, error) {
  console.error('[SW] Request error:', request.url, error.message);
  
  // HTML fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    return caches.match('/offline.html')
      .then(response => response || new Response('Offline - Please check your connection', {
        status: 503,
        headers: { 'Content-Type': 'text/html' }
      }))
      .catch(() => new Response('Service unavailable', { status: 503 }));
  }
  
  // API fallback
  if (request.url.includes('/api/')) {
    return new Response(JSON.stringify({ 
      error: 'Service unavailable',
      message: 'Please check your connection and try again later'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Service unavailable', { status: 503 });
}

// Message handling
self.addEventListener('message', (event) => {
  const { data, ports } = event;
  if (!data?.type) return;
  
  switch (data.type) {
    case 'GET_METRICS':
      ports[0]?.postMessage({ type: 'METRICS', data: metrics });
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(clearCache());
      break;
      
    case 'PREFETCH_AUDIO':
      if (data.data?.locations) {
        event.waitUntil(prefetchAudioFiles(data.data));
      }
      break;
  }
});

async function clearCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    // Keep precached files
    const toDelete = requests.filter(request => 
      !PRECACHE_URLS.some(url => request.url.includes(url.split('?')[0]))
    );
    
    await Promise.all(toDelete.map(request => cache.delete(request)));
    await cacheManager.calculateSize();
    
    console.log(`[SW] Cleared ${toDelete.length} cached items`);
    broadcastMessage({ type: 'CACHE_CLEARED' });
  } catch (error) {
    console.error('[SW] Cache clear failed:', error);
  }
}

async function prefetchAudioFiles({ userLocation, locations }) {
  if (!Array.isArray(locations)) return;
  
  console.log(`[SW] Prefetching audio for ${locations.length} locations`);
  
  try {
    const cache = await caches.open(CACHE_NAME);
    let successful = 0;
    
    // Limit to 10 locations to prevent overwhelming
    const limitedLocations = locations.slice(0, 10);
    
    for (const location of limitedLocations) {
      if (location.audioUrl) {
        try {
          const response = await fetchWithRetry(new Request(location.audioUrl));
          if (response.ok) {
            await cacheResponse(cache, new Request(location.audioUrl), response.clone(), STRATEGIES.MEDIA);
            successful++;
          }
        } catch (error) {
          console.warn('[SW] Audio prefetch failed:', location.audioUrl, error.message);
        }
      }
    }
    
    metrics.prefetches += successful;
    console.log(`[SW] Audio prefetch complete: ${successful}/${limitedLocations.length} succeeded`);
    
    broadcastMessage({ 
      type: 'PREFETCH_COMPLETE', 
      data: { successful, total: limitedLocations.length } 
    });
  } catch (error) {
    console.error('[SW] Prefetch failed:', error);
  }
}

function broadcastMessage(message) {
  self.clients.matchAll()
    .then(clients => {
      clients.forEach(client => {
        try {
          client.postMessage(message);
        } catch (error) {
          console.warn('[SW] Failed to send message to client:', error);
        }
      });
    })
    .catch(error => console.warn('[SW] Failed to broadcast message:', error));
}

console.log('[SW] Enterprise Service Worker initialized');
