// Service Worker for mnthen.com
const CACHE_NAME = 'mnthen-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/map.html',
  '/styles.css',
  '/main.js',
  // Add other important assets like images, fonts, etc.
];

// Install event - cache important files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve from cache when possible
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return the response from the cached version
        if (response) {
          return response;
        }
        
        // Not in cache - fetch and cache the response
        return fetch(event.request).then(
          response => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response since it can only be used once
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
      .catch(error => {
        // If both cache and network fail, show a fallback
        console.log('Fetch failed:', error);
        // You could return a cached fallback page here
      })
  );
});

// Handle background sync for offline functionality
self.addEventListener('sync', event => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

// Function to sync data when connection is restored
function syncData() {
  // Implement data syncing logic here
  console.log('Background sync executed');
  // This could process queued user actions or refresh data
}
