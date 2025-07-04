const CACHE_NAME = 'mnthen-enterprise-v8';
const MAX_CACHE_SIZE = 150 * 1024 * 1024; // 150MB
const CACHE_TTL = {
  STATIC: 24 * 60 * 60 * 1000, // 24 hours
  API: 12 * 60 * 60 * 1000,    // 12 hours
  MEDIA: 7 * 24 * 60 * 60 * 1000, // 1 week
  HTML: 60 * 60 * 1000         // 1 hour
};

const NETWORK_TIMEOUT = 10000;
const MAX_RETRIES = 2;

// Critical files to precache
const PRECACHE_FILES = [
  '/',
  '/offline.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/images/logo.webp',
  '/images/mnthenfav.ico',
  '/images/splash_screen.webp',
  '/manifest.json',
  '/locations_main.js'
];

// External domains to completely ignore
const EXTERNAL_DOMAINS = [
  'googleapis.com',
  'gstatic.com',
  'jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'bootstrapcdn.com',
  'fontawesome.com',
  'jquery.com',
  'openstreetmap.org',
  'fastly.net',
  'arcgisonline.com',
  'tile.openstreetmap.org'
];

// Request tracking
const pendingRequests = new Map();
let cacheSize = 0;

// Install event - precache critical files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_NAME);
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        
        // Precache files individually with error handling
        const cachePromises = PRECACHE_FILES.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) {
              await cache.put(url, response);
              console.log('[SW] Precached:', url);
            }
          } catch (error) {
            console.warn('[SW] Failed to precache:', url, error.message);
          }
        });
        
        await Promise.allSettled(cachePromises);
        await calculateCacheSize();
        await self.skipWaiting();
        
        console.log('[SW] Installation complete');
      } catch (error) {
        console.error('[SW] Installation failed:', error);
      }
    })()
  );
});

// Activate event - cleanup and take control
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_NAME);
  
  event.waitUntil(
    (async () => {
      try {
        // Delete old caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
        
        // Take control of all clients
        await self.clients.claim();
        
        // Initialize cache size tracking
        await calculateCacheSize();
        
        console.log('[SW] Activation complete, cache size:', formatBytes(cacheSize));
        
        // Notify clients
        broadcastToClients({
          type: 'SW_ACTIVATED',
          version: CACHE_NAME,
          cacheSize: cacheSize
        });
      } catch (error) {
        console.error('[SW] Activation failed:', error);
      }
    })()
  );
});

// Main fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip external domains completely
  if (isExternalDomain(url.hostname)) {
    return;
  }
  
  // Skip non-HTTP protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Skip development requests
  if (url.searchParams.has('t') || url.pathname.includes('__vite')) {
    return;
  }
  
  event.respondWith(handleRequest(request));
});

// Main request handler
async function handleRequest(request) {
  const url = new URL(request.url);
  const cacheKey = getCacheKey(request);
  
  // Prevent duplicate requests
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }
  
  const responsePromise = (async () => {
    try {
      // Determine strategy based on request type
      const strategy = getStrategy(request, url);
      
      switch (strategy) {
        case 'cache-first':
          return await cacheFirst(request);
        case 'network-first':
          return await networkFirst(request);
        case 'stale-while-revalidate':
          return await staleWhileRevalidate(request);
        case 'network-only':
          return await networkOnly(request);
        default:
          return await cacheFirst(request);
      }
    } catch (error) {
      console.error('[SW] Request failed:', request.url, error.message);
      return handleError(request, error);
    }
  })();
  
  pendingRequests.set(cacheKey, responsePromise);
  
  // Clean up when done
  responsePromise.finally(() => {
    pendingRequests.delete(cacheKey);
  });
  
  return responsePromise;
}

// Cache-first strategy (for static assets)
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse && !isExpired(cachedResponse)) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetchWithTimeout(request);
    
    if (networkResponse.ok) {
      await safeCacheResponse(cache, request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Return stale cache if available
    if (cachedResponse) {
      console.log('[SW] Returning stale cache for:', request.url);
      return cachedResponse;
    }
    throw error;
  }
}

// Network-first strategy (for API calls)
async function networkFirst(request) {
  try {
    const networkResponse = await fetchWithTimeout(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await safeCacheResponse(cache, request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Fallback to cache
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Network failed, using cache for:', request.url);
      return cachedResponse;
    }
    
    throw error;
  }
}

// Stale-while-revalidate strategy (for HTML pages)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  // Start network request in background
  const networkPromise = fetchWithTimeout(request)
    .then(networkResponse => {
      if (networkResponse.ok) {
        safeCacheResponse(cache, request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(error => {
      console.warn('[SW] Background fetch failed:', request.url, error.message);
    });
  
  // Return cache immediately if available
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // Wait for network if no cache
  return networkPromise;
}

// Network-only strategy (for external resources)
async function networkOnly(request) {
  return fetchWithTimeout(request);
}

// Determine caching strategy based on request
function getStrategy(request, url) {
  // Navigation requests
  if (request.mode === 'navigate') {
    return 'stale-while-revalidate';
  }
  
  // API endpoints
  if (url.pathname.startsWith('/api/')) {
    return 'network-first';
  }
  
  // Static assets
  const extension = getFileExtension(url.pathname);
  if (['css', 'js', 'woff', 'woff2', 'ttf', 'ico'].includes(extension)) {
    return 'cache-first';
  }
  
  // Media files
  if (['jpg', 'jpeg', 'png', 'webp', 'svg', 'mp3', 'ogg', 'wav'].includes(extension)) {
    return 'cache-first';
  }
  
  // HTML pages
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    return 'stale-while-revalidate';
  }
  
  return 'cache-first';
}

// Enhanced fetch with timeout and retry
async function fetchWithTimeout(request, timeout = NETWORK_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(request.clone(), {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    
    throw error;
  }
}

// Safe cache response with size management
async function safeCacheResponse(cache, request, response) {
  if (!response.ok || response.status === 206) {
    return;
  }
  
  // Check cache control headers
  const cacheControl = response.headers.get('cache-control') || '';
  if (cacheControl.includes('no-store') || cacheControl.includes('no-cache')) {
    return;
  }
  
  try {
    // Manage cache size
    if (cacheSize > MAX_CACHE_SIZE * 0.9) {
      await cleanupCache();
    }
    
    // Add metadata headers
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', Date.now().toString());
    headers.set('sw-cache-version', CACHE_NAME);
    
    const responseToCache = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
    
    await cache.put(request, responseToCache);
    
    // Update cache size tracking
    const blob = await response.blob();
    cacheSize += blob.size;
    
  } catch (error) {
    console.warn('[SW] Failed to cache response:', request.url, error.message);
  }
}

// Check if cached response is expired
function isExpired(response) {
  const cachedAt = response.headers.get('sw-cached-at');
  if (!cachedAt) return true;
  
  const cacheTime = parseInt(cachedAt);
  const now = Date.now();
  
  // Determine TTL based on content type
  const url = new URL(response.url);
  const extension = getFileExtension(url.pathname);
  
  let ttl = CACHE_TTL.STATIC;
  if (url.pathname.startsWith('/api/')) {
    ttl = CACHE_TTL.API;
  } else if (['jpg', 'jpeg', 'png', 'webp', 'svg', 'mp3', 'ogg', 'wav'].includes(extension)) {
    ttl = CACHE_TTL.MEDIA;
  } else if (extension === 'html' || url.pathname === '/') {
    ttl = CACHE_TTL.HTML;
  }
  
  return (now - cacheTime) > ttl;
}

// Error handling
async function handleError(request, error) {
  console.error('[SW] Handling error for:', request.url, error.message);
  
  // For navigation requests, return offline page
  if (request.mode === 'navigate') {
    const cache = await caches.open(CACHE_NAME);
    const offlinePage = await cache.match('/offline.html');
    
    if (offlinePage) {
      return offlinePage;
    }
    
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head><title>Offline</title></head>
        <body>
          <h1>You're offline</h1>
          <p>Please check your internet connection and try again.</p>
        </body>
      </html>
    `, {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  // For API requests, return JSON error
  if (request.url.includes('/api/')) {
    return new Response(JSON.stringify({
      error: 'Service unavailable',
      message: 'Please check your connection and try again'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // For other requests, return generic error
  return new Response('Service unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

// Cache cleanup
async function cleanupCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    // Sort by cache time (oldest first)
    const entries = [];
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const cachedAt = response.headers.get('sw-cached-at');
        const isPrecached = PRECACHE_FILES.includes(new URL(request.url).pathname);
        
        if (!isPrecached && cachedAt) {
          entries.push({
            request,
            cachedAt: parseInt(cachedAt),
            size: (await response.blob()).size
          });
        }
      }
    }
    
    // Sort by oldest first
    entries.sort((a, b) => a.cachedAt - b.cachedAt);
    
    // Delete oldest entries until we're under 70% capacity
    const targetSize = MAX_CACHE_SIZE * 0.7;
    let currentSize = cacheSize;
    
    for (const entry of entries) {
      if (currentSize <= targetSize) break;
      
      await cache.delete(entry.request);
      currentSize -= entry.size;
      console.log('[SW] Cleaned up:', entry.request.url);
    }
    
    cacheSize = currentSize;
    console.log('[SW] Cache cleanup complete, new size:', formatBytes(cacheSize));
    
  } catch (error) {
    console.error('[SW] Cache cleanup failed:', error);
  }
}

// Calculate total cache size
async function calculateCacheSize() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    let totalSize = 0;
    for (const request of requests) {
      try {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      } catch (error) {
        console.warn('[SW] Error calculating size for:', request.url);
      }
    }
    
    cacheSize = totalSize;
    return totalSize;
  } catch (error) {
    console.error('[SW] Error calculating cache size:', error);
    return 0;
  }
}

// Message handling
self.addEventListener('message', async (event) => {
  const { data, ports } = event;
  
  if (!data?.type) return;
  
  switch (data.type) {
    case 'GET_CACHE_SIZE':
      const size = await calculateCacheSize();
      ports[0]?.postMessage({ type: 'CACHE_SIZE', size: formatBytes(size) });
      break;
      
    case 'CLEAR_CACHE':
      await clearAllCache();
      ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
      break;
      
    case 'PREFETCH_URLS':
      if (data.urls) {
        await prefetchUrls(data.urls);
        ports[0]?.postMessage({ type: 'PREFETCH_COMPLETE' });
      }
      break;
  }
});

// Clear all cache except precached files
async function clearAllCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    const toDelete = requests.filter(request => {
      const path = new URL(request.url).pathname;
      return !PRECACHE_FILES.includes(path);
    });
    
    await Promise.all(toDelete.map(request => cache.delete(request)));
    await calculateCacheSize();
    
    console.log('[SW] Cleared cache, kept', PRECACHE_FILES.length, 'precached files');
  } catch (error) {
    console.error('[SW] Error clearing cache:', error);
  }
}

// Prefetch URLs
async function prefetchUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  
  for (const url of urls.slice(0, 20)) { // Limit to 20 URLs
    try {
      const response = await fetchWithTimeout(new Request(url));
      if (response.ok) {
        await safeCacheResponse(cache, new Request(url), response.clone());
      }
    } catch (error) {
      console.warn('[SW] Prefetch failed for:', url, error.message);
    }
  }
}

// Utility functions
function isExternalDomain(hostname) {
  return EXTERNAL_DOMAINS.some(domain => hostname.includes(domain));
}

function getFileExtension(pathname) {
  return pathname.split('.').pop()?.toLowerCase() || '';
}

function getCacheKey(request) {
  return `${request.method}:${request.url}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function broadcastToClients(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      try {
        client.postMessage(message);
      } catch (error) {
        console.warn('[SW] Failed to send message to client:', error);
      }
    });
  });
}

console.log('[SW] Service Worker initialized:', CACHE_NAME);
