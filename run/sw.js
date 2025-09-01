const CACHE_NAME = 'runflow-v1.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install event - cache resources
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('RunFlow: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(function() {
        console.log('RunFlow: App shell cached successfully');
        return self.skipWaiting();
      })
      .catch(function(error) {
        console.log('RunFlow: Cache installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('RunFlow: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      console.log('RunFlow: Service worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Return cached version or fetch from network
        if (response) {
          console.log('RunFlow: Serving from cache:', event.request.url);
          return response;
        }

        // Clone the request for cache
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(function(response) {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response for cache
          const responseToCache = response.clone();

          // Add to cache for future offline access
          caches.open(CACHE_NAME)
            .then(function(cache) {
              // Only cache same-origin requests and specific external resources
              if (event.request.url.startsWith(self.location.origin) || 
                  event.request.url.includes('cdnjs.cloudflare.com') ||
                  event.request.url.includes('unpkg.com')) {
                cache.put(event.request, responseToCache);
              }
            });

          return response;
        }).catch(function() {
          // If network fails, try to serve a cached response
          return caches.match('/index.html');
        });
      })
  );
});

// Background sync for data persistence
self.addEventListener('sync', function(event) {
  if (event.tag === 'background-sync') {
    console.log('RunFlow: Background sync triggered');
    event.waitUntil(
      // Perform any necessary background sync operations
      Promise.resolve()
    );
  }
});

// Push notifications support
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: 'https://images.pexels.com/photos/1544717/pexels-photo-1544717.jpeg?auto=compress&cs=tinysrgb&w=192&h=192&fit=crop&crop=center',
      badge: 'https://images.pexels.com/photos/1544717/pexels-photo-1544717.jpeg?auto=compress&cs=tinysrgb&w=72&h=72&fit=crop&crop=center',
      vibrate: [200, 100, 200],
      data: data.data || {},
      actions: [
        {
          action: 'open',
          title: 'Open RunFlow'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'RunFlow', options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

console.log('RunFlow Service Worker loaded successfully');
