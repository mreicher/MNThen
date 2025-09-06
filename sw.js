// sw.js – Minnesota Then Service Worker
// Version: 4.1.0 (Error-free with audio support)

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

// Audio file extensions (for special handling)
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mpeg|mkv)$/i;

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
    
    // Only cache successful full responses (avoid 206 partial content)
    if (response.status === 200) {
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
    
    // Cache successful full responses only
    if (response.status === 200) {
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

// Special handler for audio files
async function handleAudioRequest(request) {
  try {
    // For range requests (audio streaming), bypass cache completely
    if (request.headers.has('range')) {
      return fetch(request);
    }
    
    // Try cache first for full audio requests
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    // Not in cache - fetch with CORS awareness
    const response = await fetch(request, {
      mode: 'cors',
      credentials: 'same-origin'
    });
    
    // Cache successful full audio responses
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.error('Audio request failed:', error);
    // Fallback to direct fetch for audio
    return fetch(request);
  }
}

// Check if URL should never be cached
function shouldNeverCache(url) {
  return NEVER_CACHE.some(pattern => url.includes(pattern));
}

// Check if URL is audio/video
function isMediaFile(url) {
  return AUDIO_EXTENSIONS.test(url) || VIDEO_EXTENSIONS.test(url);
}

// Main fetch handler
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  const request = event.request;
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Special handling for audio/video files
  if (isMediaFile(url)) {
    event.respondWith(handleAudioRequest(request));
    return;
  }
  
  // Never cache certain files - always fetch fresh
  if (shouldNeverCache(url)) {
    event.respondWith(fetch(request));
    return;
  }
  
  // Handle different resource types
  if (url.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico)$/i)) {
    // Static assets - cache first
    event.respondWith(cacheFirst(request));
  } else if (url.includes('/api/') || url.includes('geolocation')) {
    // API calls - network first
    event.respondWith(networkFirst(request));
  } else {
    // Everything else - cache first with network fallback
    event.respondWith(cacheFirst(request));
  }
});

// Install event - cache critical resources
self.addEventListener('install', (event) => {
  console.log('Service Worker 4.1.0: Installing...');
  
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
  console.log('Service Worker 4.1.0: Activating...');
  
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

console.log('Service Worker 4.1.0: Loaded successfully with audio support');
