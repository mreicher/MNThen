const CACHE_NAME = 'mnthen-complete-v10';
const CACHE_VERSION = '10.0.0';

// Complete precache list - all your pages and assets
const PRECACHE_URLS = [
  // Main pages
  '/',
  '/index.html',
  '/offline.html',
  
  // CSS files
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  
  // JavaScript files
  '/locations_main.js',
  '/js/app.js',
  '/js/map.js',
  
  // Images
  '/images/logo.webp',
  '/images/mnthenfav.ico',
  '/images/splash_screen.webp',
  '/images/social-share.jpg',
  '/placeholder.svg',
  
  // Other assets
  '/manifest.json',
  
  // Add your other pages here - examples:
  '/about.html',
  '/contact.html',
  '/locations.html',
  '/history.html',
  '/explore.html'
];

// Domains to skip
const SKIP_DOMAINS = [
  'googleapis.com',
  'gstatic.com',
  'jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'openstreetmap.org',
  'tile.openstreetmap.org',
  'fastly.net',
  'arcgisonline.com',
  'bootstrapcdn.com',
  'fontawesome.com',
  'jquery.com'
];

// Install event - precache all files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing:', CACHE_NAME);
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        
        // Cache files one by one to handle failures gracefully
        const results = await Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            try {
              const response = await fetch(url);
              if (response.ok) {
                await cache.put(url, response);
                console.log('[SW] Precached:', url);
                return { url, success: true };
              } else {
                console.warn('[SW] Failed to precache (not ok):', url, response.status);
                return { url, success: false, error: `Status ${response.status}` };
              }
            } catch (error) {
              console.warn('[SW] Failed to precache (error):', url, error.message);
              return { url, success: false, error: error.message };
            }
          })
        );
        
        // Log results
        const successful = results.filter(r => r.value?.success).length;
        const failed = results.filter(r => !r.value?.success).length;
        
        console.log(`[SW] Precache complete: ${successful} successful, ${failed} failed`);
        
        // Skip waiting to activate immediately
        await self.skipWaiting();
      } catch (error) {
        console.error('[SW] Install failed:', error);
      }
    })()
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating:', CACHE_NAME);
  
  event.waitUntil(
    (async () => {
      try {
        // Clean old caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
        
        // Take control of all clients
        await self.clients.claim();
        
        console.log('[SW] Activation complete');
        
        // Notify clients
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: CACHE_VERSION,
            precachedFiles: PRECACHE_URLS.length
          });
        });
      } catch (error) {
        console.error('[SW] Activation failed:', error);
      }
    })()
  );
});

// Fetch event handler
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip non-HTTP requests
  if (!request.url.startsWith('http')) {
    return;
  }
  
  // Skip external domains
  if (shouldSkipDomain(url.hostname)) {
    return;
  }
  
  // Skip development requests
  if (url.pathname.includes('__vite') || url.searchParams.has('t')) {
    return;
  }
  
  event.respondWith(handleRequest(request));
});

// Check if we should skip this domain
function shouldSkipDomain(hostname) {
  const currentOrigin = new URL(self.location.origin).hostname;
  
  // Always handle requests from same origin
  if (hostname === currentOrigin) {
    return false;
  }
  
  // Skip known external domains
  return SKIP_DOMAINS.some(domain => hostname.includes(domain));
}

// Main request handler
async function handleRequest(request) {
  const url = new URL(request.url);
  
  try {
    // Check if this is a precached file first
    if (isPrecachedFile(url.pathname)) {
      return await handlePrecachedFile(request);
    }
    
    // Handle different request types
    if (isNavigationRequest(request)) {
      return await handleNavigation(request);
    } else if (isStaticAsset(url)) {
      return await handleStaticAsset(request);
    } else if (isApiRequest(url)) {
      return await handleApiRequest(request);
    } else {
      return await handleDefault(request);
    }
  } catch (error) {
    console.error('[SW] Request failed:', request.url, error);
    return await handleError(request, error);
  }
}

// Check if file is precached
function isPrecachedFile(pathname) {
  return PRECACHE_URLS.includes(pathname) || 
         PRECACHE_URLS.includes(pathname + '.html') ||
         (pathname === '/' && PRECACHE_URLS.includes('/index.html'));
}

// Handle precached files
async function handlePrecachedFile(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  
  // Try exact match first
  let cachedResponse = await cache.match(request);
  
  // Try with .html extension
  if (!cachedResponse && !url.pathname.endsWith('.html')) {
    cachedResponse = await cache.match(url.pathname + '.html');
  }
  
  // Try index.html for root
  if (!cachedResponse && url.pathname === '/') {
    cachedResponse = await cache.match('/index.html');
  }
  
  if (cachedResponse) {
    console.log('[SW] Serving precached file:', request.url);
    return cachedResponse;
  }
  
  // If not found in cache, try network
  try {
    const networkResponse = await fetchWithTimeout(request, 5000);
    if (networkResponse.ok) {
      // Update cache
      cache.put(request, networkResponse.clone()).catch(err => {
        console.warn('[SW] Failed to update cache:', err);
      });
      return networkResponse;
    }
  } catch (error) {
    console.warn('[SW] Network failed for precached file:', error.message);
  }
  
  throw new Error('Precached file not available');
}

// Check if this is a navigation request
function isNavigationRequest(request) {
  return request.mode === 'navigate' || 
         request.destination === 'document' ||
         (request.headers.get('accept') || '').includes('text/html');
}

// Check if this is a static asset
function isStaticAsset(url) {
  const extension = url.pathname.split('.').pop()?.toLowerCase();
  return ['css', 'js', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'otf'].includes(extension);
}

// Check if this is an API request
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

// Handle navigation requests
async function handleNavigation(request) {
  console.log('[SW] Navigation request:', request.url);
  
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  
  // Try cache first for navigation
  let cachedResponse = await cache.match(request);
  
  // Try to find matching cached page
  if (!cachedResponse) {
    // Try with .html extension
    if (!url.pathname.endsWith('.html') && !url.pathname.endsWith('/')) {
      cachedResponse = await cache.match(url.pathname + '.html');
    }
    
    // Try index.html for root or directories
    if (!cachedResponse && (url.pathname === '/' || url.pathname.endsWith('/'))) {
      cachedResponse = await cache.match('/index.html') || await cache.match('/');
    }
  }
  
  // If we have a cached version, serve it and update in background
  if (cachedResponse) {
    console.log('[SW] Serving cached navigation');
    
    // Update in background
    fetchWithTimeout(request, 3000)
      .then(networkResponse => {
        if (networkResponse.ok) {
          cache.put(request, networkResponse.clone());
          console.log('[SW] Updated cached navigation');
        }
      })
      .catch(err => console.warn('[SW] Background update failed:', err));
    
    return cachedResponse;
  }
  
  // No cache, try network
  try {
    const networkResponse = await fetchWithTimeout(request, 5000);
    
    if (networkResponse.ok) {
      // Cache the response
      cache.put(request, networkResponse.clone()).catch(err => {
        console.warn('[SW] Failed to cache navigation:', err);
      });
      return networkResponse;
    }
    
    throw new Error('Network response not ok');
  } catch (error) {
    console.log('[SW] Navigation network failed:', error.message);
    
    // Try to serve offline page or root page
    const offlineResponse = await cache.match('/offline.html') || 
                           await cache.match('/') || 
                           await cache.match('/index.html');
    
    if (offlineResponse) {
      console.log('[SW] Serving offline fallback');
      return offlineResponse;
    }
    
    throw error;
  }
}

// Handle static assets
async function handleStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  
  // Try cache first
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    console.log('[SW] Serving cached static asset');
    
    // Update in background if old
    const cacheDate = cachedResponse.headers.get('sw-cache-date');
    if (!cacheDate || (Date.now() - parseInt(cacheDate)) > 24 * 60 * 60 * 1000) {
      fetchWithTimeout(request, 8000)
        .then(networkResponse => {
          if (networkResponse.ok) {
            const headers = new Headers(networkResponse.headers);
            headers.set('sw-cache-date', Date.now().toString());
            
            const responseToCache = new Response(networkResponse.body, {
              status: networkResponse.status,
              statusText: networkResponse.statusText,
              headers: headers
            });
            
            cache.put(request, responseToCache);
          }
        })
        .catch(err => console.warn('[SW] Background update failed:', err));
    }
    
    return cachedResponse;
  }
  
  // Not in cache, fetch from network
  try {
    const networkResponse = await fetchWithTimeout(request, 10000);
    
    if (networkResponse.ok) {
      const headers = new Headers(networkResponse.headers);
      headers.set('sw-cache-date', Date.now().toString());
      
      const responseToCache = new Response(networkResponse.body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers: headers
      });
      
      cache.put(request, responseToCache).catch(err => {
        console.warn('[SW] Failed to cache static asset:', err);
      });
      
      return networkResponse;
    }
    
    throw new Error('Network response not ok');
  } catch (error) {
    console.log('[SW] Static asset network failed:', error.message);
    throw error;
  }
}

// Handle API requests
async function handleApiRequest(request) {
  try {
    const networkResponse = await fetchWithTimeout(request, 8000);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      const headers = new Headers(networkResponse.headers);
      headers.set('sw-cache-date', Date.now().toString());
      
      const responseToCache = new Response(networkResponse.body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers: headers
      });
      
      cache.put(request, responseToCache).catch(err => {
        console.warn('[SW] Failed to cache API response:', err);
      });
      
      return networkResponse;
    }
    
    throw new Error('Network response not ok');
  } catch (error) {
    // Try cache as fallback
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Serving cached API response');
      return cachedResponse;
    }
    
    throw error;
  }
}

// Handle default requests
async function handleDefault(request) {
  try {
    return await fetchWithTimeout(request, 10000);
  } catch (error) {
    console.log('[SW] Default request failed:', error.message);
    throw error;
  }
}

// Handle errors
async function handleError(request, error) {
  console.log('[SW] Handling error for:', request.url);
  
  if (isNavigationRequest(request)) {
    const cache = await caches.open(CACHE_NAME);
    
    // Try offline page first
    const offlineResponse = await cache.match('/offline.html');
    if (offlineResponse) {
      return offlineResponse;
    }
    
    // Try root page
    const rootResponse = await cache.match('/') || await cache.match('/index.html');
    if (rootResponse) {
      return rootResponse;
    }
    
    // Create basic offline response
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Offline - MN Then</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            button { padding: 10px 20px; font-size: 16px; }
          </style>
        </head>
        <body>
          <h1>You're offline</h1>
          <p>Please check your internet connection and try again.</p>
          <button onclick="window.location.reload()">Retry</button>
        </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  if (isApiRequest(new URL(request.url))) {
    return new Response(JSON.stringify({
      error: 'Service unavailable',
      message: 'Please check your connection and try again'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Service unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

// Fetch with timeout
async function fetchWithTimeout(request, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(request, { signal: controller.signal });
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

// Message handling
self.addEventListener('message', (event) => {
  const { data, ports } = event;
  
  if (!data || !data.type) return;
  
  switch (data.type) {
    case 'GET_CACHE_INFO':
      getCacheInfo().then(info => {
        ports[0]?.postMessage({ type: 'CACHE_INFO', data: info });
      });
      break;
      
    case 'CLEAR_CACHE':
      clearDynamicCache().then(() => {
        ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
      });
      break;
      
    case 'PRECACHE_URLS':
      if (data.urls) {
        precacheUrls(data.urls).then(() => {
          ports[0]?.postMessage({ type: 'PRECACHE_COMPLETE' });
        });
      }
      break;
  }
});

// Get cache info
async function getCacheInfo() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    
    return {
      version: CACHE_VERSION,
      totalFiles: keys.length,
      precachedFiles: PRECACHE_URLS.length
    };
  } catch (error) {
    console.error('[SW] Error getting cache info:', error);
    return null;
  }
}

// Clear dynamic cache (keep precached)
async function clearDynamicCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    const deletePromises = requests
      .filter(request => {
        const url = new URL(request.url);
        return !isPrecachedFile(url.pathname);
      })
      .map(request => cache.delete(request));
    
    await Promise.all(deletePromises);
    console.log('[SW] Dynamic cache cleared');
  } catch (error) {
    console.error('[SW] Error clearing cache:', error);
  }
}

// Precache additional URLs
async function precacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  
  for (const url of urls.slice(0, 20)) {
    try {
      const response = await fetchWithTimeout(new Request(url), 5000);
      if (response.ok) {
        await cache.put(url, response);
        console.log('[SW] Precached additional URL:', url);
      }
    } catch (error) {
      console.warn('[SW] Failed to precache URL:', url, error.message);
    }
  }
}

console.log('[SW] Service Worker initialized:', CACHE_NAME);
console.log('[SW] Will precache', PRECACHE_URLS.length, 'files');