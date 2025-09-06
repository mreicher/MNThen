// sw.js – Minnesota Then Service Worker
// Version: 4.0.0 (Rewritten for reliability)

const CACHE_NAME = 'mnthen-v4';
const RUNTIME_CACHE = 'mnthen-runtime-v4';

// Critical resources to cache on install
const STATIC_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Resources that should NEVER be cached (always fetch fresh)
const NEVER_CACHE = [
  '/locations_main.js',  // Your locations array - always fresh
  '/manifest.json'       // Manifest should always be fresh
];

// Simple cache-first strategy with fallback
async function cacheFirst(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    // Not in cache - fetch and cache
    const response = await fetch(request);
    
    if (response.ok && response.status === 200) {
    cache.put(request, response.clone());
  }
    
    return response;
  } catch (error) {
    console.error('Cache-first failed:', error);
    // Try to return cached version as fallback
    const cache = await caches.open(CACHE_NAME);
    const fallback = await cache.match(request);
    return fallback || new Response('Resource unavailable', { status: 503 });
  }
}

// Network-first strategy (for dynamic content)
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    
    // Cache successful responses
    if (response.ok && response.status < 400) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    // Network failed - try cache
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    return cached || new Response('Resource unavailable', { status: 503 });
  }
}

// Check if URL should never be cached
function shouldNeverCache(url) {
  return NEVER_CACHE.some(pattern => url.includes(pattern));
}

// Main fetch handler
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Never cache certain files - always fetch fresh
  if (shouldNeverCache(url)) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Handle different resource types
  if (url.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico)$/i)) {
    // Static assets - cache first
    event.respondWith(cacheFirst(event.request));
  } else if (url.includes('/api/') || url.includes('geolocation')) {
    // API calls - network first
    event.respondWith(networkFirst(event.request));
  } else {
    // Everything else - cache first with network fallback
    event.respondWith(cacheFirst(event.request));
  }
});

// Install event - cache critical resources
self.addEventListener('install', (event) => {
  console.log('Service Worker 4.0.0: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Caching static resources');
      return cache.addAll(STATIC_RESOURCES).catch(error => {
        console.error('Failed to cache some static resources:', error);
        // Don't fail the install if some resources fail to cache
        return Promise.resolve();
      });
    })
  );
  
  // Skip waiting - activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker 4.0.0: Activating...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Delete old caches
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(names => {
      return Promise.all(names.map(name => caches.delete(name)));
    }).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});

// Error handling
self.addEventListener('error', (event) => {
  console.error('Service Worker Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker Unhandled Promise Rejection:', event.reason);
});

console.log('Service Worker 4.0.0: Loaded successfully');

