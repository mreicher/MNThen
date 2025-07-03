const CACHE_NAME = 'mnthen-enterprise-v6';
const MAX_CACHE_SIZE = 150 * 1024 * 1024; // 150MB (increased for GIS assets)
const LOCATION_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours (reduced for fresher data)
const AUDIO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 week for audio files
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE = 1000; // Base delay with exponential backoff
const NETWORK_TIMEOUT = 15000; // 15s timeout for network requests

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
].map(url => `${url}?v=6`); // Versioned URLs

// Cache strategies with priority levels
const STRATEGIES = {
  PRECACHE: {name: 'precache', priority: 1},
  CRITICAL: {name: 'critical', priority: 1}, // CSS, JS, core assets
  API_DATA: {name: 'api-data', priority: 2}, // Location data
  MEDIA: {name: 'media', priority: 3}, // Images, audio
  FALLBACK: {name: 'fallback', priority: 4} // Offline fallbacks
};

// Enhanced trusted origins for CDNs and APIs
const TRUSTED_ORIGINS = [
  self.location.origin,
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://cdnjs.cloudflare.com',
  'https://tile.openstreetmap.org',
  'https://api.mnthen.com'
];

// Performance metrics with persistence
const metrics = {
  cacheHits: 0,
  cacheMisses: 0,
  networkRequests: 0,
  errors: 0,
  prefetches: 0,
  startTime: Date.now(),
  lastUpdated: Date.now(),
  
  // Persistent storage for metrics
  async save() {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      new Request('/sw-metrics'),
      new Response(JSON.stringify(this))
    );
  },
  
  async load() {
    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match('/sw-metrics');
      if (response) {
        const data = await response.json();
        Object.assign(this, data);
      }
    } catch (error) {
      console.error('[SW] Error loading metrics:', error);
    }
  }
};

// Initialize metrics
metrics.load();

// Enhanced cache management with size tracking
class CacheManager {
  constructor() {
    this.currentSize = 0;
    this.estimatedSize = 0;
  }
  
  async init() {
    await this.calculateSize();
  }
  
  async calculateSize() {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    
    this.currentSize = 0;
    await Promise.all(keys.map(async request => {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        this.currentSize += blob.size;
      }
    }));
    
    return this.currentSize;
  }
  
  async addToSizeEstimate(request, response) {
    if (response) {
      const blob = await response.blob();
      this.estimatedSize += blob.size;
      
      // Check if we need to purge before adding
      if (this.estimatedSize + this.currentSize > MAX_CACHE_SIZE * 0.8) {
        await this.purge(MAX_CACHE_SIZE * 0.2);
      }
    }
  }
  
  async purge(targetSize) {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const entries = [];
    
    // Collect cache entries with metadata
    await Promise.all(keys.map(async request => {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        const cachedAt = response.headers.get('sw-cached-at') || Date.now();
        const strategy = response.headers.get('sw-strategy') || STRATEGIES.FALLBACK.name;
        
        entries.push({
          request,
          size: blob.size,
          cachedAt: parseInt(cachedAt),
          strategy,
          isPrecached: PRECACHE_URLS.some(url => request.url.includes(url))
        });
      }
    }));
    
    // Sort by priority (precached last) and oldest first
    entries.sort((a, b) => {
      if (a.isPrecached !== b.isPrecached) return a.isPrecached ? 1 : -1;
      if (a.strategy !== b.strategy) {
        return STRATEGIES[a.strategy].priority - STRATEGIES[b.strategy].priority;
      }
      return a.cachedAt - b.cachedAt;
    });
    
    let bytesFreed = 0;
    for (const entry of entries) {
      if (bytesFreed >= targetSize) break;
      if (!entry.isPrecached) {
        await cache.delete(entry.request);
        bytesFreed += entry.size;
        console.log(`[SW] Purged: ${entry.request.url} (${entry.size} bytes)`);
      }
    }
    
    this.currentSize -= bytesFreed;
    return bytesFreed;
  }
}

const cacheManager = new CacheManager();

self.addEventListener('install', (event) => {
  console.log('[SW] Installing Enterprise SW version', CACHE_NAME);
  
  event.waitUntil(
    (async () => {
      await cacheManager.init();
      const cache = await caches.open(CACHE_NAME);
      
      // Parallel precaching with progress reporting
      const queue = new WorkQueue(3); // 3 parallel requests
      await Promise.all(PRECACHE_URLS.map(url => 
        queue.add(() => cache.add(url).catch(console.error))
      ));
      
      console.log('[SW] Precaching complete');
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Enterprise SW');
  
  event.waitUntil(
    (async () => {
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
      await cacheManager.init();
      await cleanupExpiredCache();
      
      // Claim clients immediately
      await self.clients.claim();
      
      console.log('[SW] Activation complete');
      broadcastMessage({ 
        type: 'SW_ACTIVATED', 
        version: CACHE_NAME,
        initialCacheSize: cacheManager.currentSize 
      });
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET and non-http(s) requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }
  
  // Skip Vite HMR requests during development
  if (url.pathname.includes('__vite_ping') || url.searchParams.has('t')) {
    return;
  }
  
  // Determine strategy based on request type
  const strategy = determineStrategy(request, url);
  
  event.respondWith(
    (async () => {
      try {
        const startTime = performance.now();
        const response = await handleRequest(event, strategy);
        const duration = performance.now() - startTime;
        
        // Update metrics
        updateMetrics(response, duration);
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
  // Security: Only cache same-origin or trusted origins
  if (!TRUSTED_ORIGINS.includes(url.origin)) {
    return STRATEGIES.FALLBACK;
  }
  
  // Precached assets
  if (PRECACHE_URLS.some(precacheUrl => url.pathname + (url.search || '') === precacheUrl)) {
    return STRATEGIES.PRECACHE;
  }
  
  // API endpoints
  if (url.pathname.startsWith('/api/')) {
    // Location data gets frequent updates
    if (url.pathname.includes('/locations')) {
      return STRATEGIES.API_DATA;
    }
    return STRATEGIES.FALLBACK;
  }
  
  // Static assets
  const extension = url.pathname.split('.').pop().toLowerCase();
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
      return STRATEGIES.MEDIA;
      
    case 'mp3':
    case 'ogg':
    case 'wav':
      return { ...STRATEGIES.MEDIA, ttl: AUDIO_CACHE_TTL };
      
    default:
      return STRATEGIES.FALLBACK;
  }
}

async function handleRequest(event, strategy) {
  const { request } = event;
  const cache = await caches.open(CACHE_NAME);
  
  // Create a request key for deduplication
  const requestKey = `${request.method}:${request.url}`;
  
  // Check for in-flight requests
  if (inFlightRequests.has(requestKey)) {
    return inFlightRequests.get(requestKey);
  }
  
  let responsePromise;
  
  switch (strategy.name) {
    case 'precache':
      responsePromise = handlePrecache(request, cache);
      break;
      
    case 'critical':
      responsePromise = handleCriticalAssets(request, cache, event);
      break;
      
    case 'api-data':
      responsePromise = handleApiData(request, cache, event);
      break;
      
    case 'media':
      responsePromise = handleMedia(request, cache, event, strategy.ttl);
      break;
      
    default:
      responsePromise = handleFallback(request, cache, event);
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
  // Try cache first for critical assets
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    metrics.cacheHits++;
    
    // Update in background
    event.waitUntil(
      fetchWithRetry(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            return cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.CRITICAL);
          }
        })
        .catch(console.error)
    );
    
    return addSecurityHeaders(cachedResponse);
  }
  
  // Fallback to network with cache update
  try {
    const networkResponse = await fetchWithRetry(request);
    if (networkResponse.ok) {
      event.waitUntil(
        cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.CRITICAL)
      );
    }
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    throw error;
  }
}

async function handleApiData(request, cache, event) {
  // API data - network first with cache fallback
  try {
    const networkResponse = await fetchWithRetry(request);
    if (networkResponse.ok) {
      event.waitUntil(
        cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.API_DATA)
      );
    }
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    // Try cache if network fails
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      metrics.cacheHits++;
      return addSecurityHeaders(cachedResponse);
    }
    throw error;
  }
}

async function handleMedia(request, cache, event, ttl = LOCATION_CACHE_TTL) {
  // Media files - cache first with background update
  const cachedResponse = await cache.match(request);
  const isStale = cachedResponse ? isResponseStale(cachedResponse, ttl) : true;
  
  if (cachedResponse && !isStale) {
    metrics.cacheHits++;
    return addSecurityHeaders(cachedResponse);
  }
  
  // Background update for stale content
  if (cachedResponse && isStale) {
    event.waitUntil(
      fetchWithRetry(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            return cacheResponse(cache, request, networkResponse.clone(), STRATEGIES.MEDIA);
          }
        })
        .catch(console.error)
    );
    metrics.cacheHits++;
    return addSecurityHeaders(cachedResponse);
  }
  
  // No cache entry - fetch fresh
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
    throw error;
  }
}

async function handleFallback(request, cache, event) {
  // Generic fallback strategy
  try {
    const networkResponse = await fetchWithRetry(request);
    metrics.networkRequests++;
    return addSecurityHeaders(networkResponse);
  } catch (error) {
    // Try cache if network fails
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      metrics.cacheHits++;
      return addSecurityHeaders(cachedResponse);
    }
    
    // Final fallback for HTML requests
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
    throw new Error(`Max retries (${MAX_RETRY_ATTEMPTS}) exceeded`);
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
    
    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(request, attempt + 1);
    }
    
    throw error;
  }
}

async function cacheResponse(cache, request, response, strategy) {
  if (!response || !response.ok) return;
  
  // Check cache control headers
  const cacheControl = response.headers.get('cache-control') || '';
  if (cacheControl.includes('no-store') || cacheControl.includes('no-cache')) {
    return;
  }
  
  // Prepare response for caching
  const headers = new Headers(response.headers);
  headers.set('sw-cached-at', Date.now().toString());
  headers.set('sw-strategy', strategy.name);
  headers.set('sw-cache-version', CACHE_NAME);
  
  const body = await response.blob();
  await cacheManager.addToSizeEstimate(request, response);
  
  return cache.put(request, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  }));
}

function addSecurityHeaders(response) {
  if (!response) return response;
  
  const headers = new Headers(response.headers);
  
  // Security headers
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'DENY');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
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

async function cleanupExpiredCache() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  
  await Promise.all(requests.map(async request => {
    const response = await cache.match(request);
    if (!response) return;
    
    const strategy = response.headers.get('sw-strategy') || STRATEGIES.FALLBACK.name;
    const cachedAt = response.headers.get('sw-cached-at');
    const maxAge = strategy === STRATEGIES.MEDIA.name ? AUDIO_CACHE_TTL : LOCATION_CACHE_TTL;
    
    if (cachedAt && Date.now() - parseInt(cachedAt) > maxAge) {
      await cache.delete(request);
      console.log(`[SW] Expired cache removed: ${request.url}`);
    }
  }));
  
  await cacheManager.purge(MAX_CACHE_SIZE * 0.1); // Proactive cleanup
}

function updateMetrics(response, duration) {
  if (response) {
    if (response.headers.get('sw-cached-at')) {
      metrics.cacheHits++;
    } else {
      metrics.networkRequests++;
    }
  }
  
  metrics.lastUpdated = Date.now();
  metrics.save();
}

function handleRequestError(request, error) {
  console.error('[SW] Request error:', request.url, error);
  
  // HTML fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    return caches.match('/offline.html')
      .then(response => response || new Response('Offline - Please check your connection'));
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
  
  return new Response('', { status: 503 });
}

// Message handling
self.addEventListener('message', (event) => {
  const { data, ports } = event;
  if (!data || !data.type) return;
  
  switch (data.type) {
    case 'PREFETCH_AUDIO':
      event.waitUntil(prefetchAudioFiles(data.data));
      break;
      
    case 'GET_METRICS':
      ports[0]?.postMessage({ type: 'METRICS', data: metrics });
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(clearCache());
      break;
      
    case 'UPDATE_CACHE':
      event.waitUntil(updateCache());
      break;
  }
});

async function prefetchAudioFiles({ userLocation, locations }) {
  if (!Array.isArray(locations)) return;
  
  console.log(`[SW] Prefetching audio for ${locations.length} locations`);
  const cache = await caches.open(CACHE_NAME);
  
  // Sort locations by proximity to user
  locations.sort((a, b) => {
    const distA = userLocation ? calculateDistance(userLocation, a) : 0;
    const distB = userLocation ? calculateDistance(userLocation, b) : 0;
    return distA - distB;
  });
  
  // Limit to closest 10 locations
  const closestLocations = locations.slice(0, 10);
  metrics.prefetches += closestLocations.length;
  
  const results = await Promise.allSettled(
    closestLocations.map(location => prefetchLocationAudio(cache, location))
  );
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[SW] Audio prefetch complete: ${successful}/${closestLocations.length} succeeded`);
  
  await cleanupExpiredCache();
  broadcastMessage({ 
    type: 'PREFETCH_COMPLETE', 
    data: { successful, total: closestLocations.length } 
  });
}

async function prefetchLocationAudio(cache, location) {
  if (!location.audioUrl) return;
  
  try {
    const response = await fetchWithRetry(new Request(location.audioUrl));
    if (response.ok) {
      await cacheResponse(cache, new Request(location.audioUrl), response.clone(), STRATEGIES.MEDIA);
    }
  } catch (error) {
    console.error('[SW] Audio prefetch failed:', location.audioUrl, error);
    throw error;
  }
}

function calculateDistance(pos1, pos2) {
  if (!pos1 || !pos2) return Infinity;
  
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

async function clearCache() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  
  // Keep precached files
  const toDelete = requests.filter(request => 
    !PRECACHE_URLS.some(url => request.url.includes(url))
  );
  
  await Promise.all(toDelete.map(request => cache.delete(request)));
  await cacheManager.calculateSize();
  
  console.log(`[SW] Cleared ${toDelete.length} cached items`);
  broadcastMessage({ type: 'CACHE_CLEARED' });
}

async function updateCache() {
  const cache = await caches.open(CACHE_NAME);
  
  // Update precached files
  await Promise.all(PRECACHE_URLS.map(async url => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) {
        await cache.put(url, response);
      }
    } catch (error) {
      console.error('[SW] Cache update failed:', url, error);
    }
  }));
  
  console.log('[SW] Cache update complete');
  broadcastMessage({ type: 'CACHE_UPDATED' });
}

function broadcastMessage(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => client.postMessage(message));
  });
}

// Helper class for parallel request management
class WorkQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.queue = [];
    this.running = 0;
  }
  
  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }
  
  next() {
    while (this.running < this.concurrency && this.queue.length) {
      const { task, resolve, reject } = this.queue.shift();
      this.running++;
      
      task()
        .then(resolve, reject)
        .finally(() => {
          this.running--;
          this.next();
        });
    }
  }
}

console.log('[SW] Enterprise Service Worker initialized');
