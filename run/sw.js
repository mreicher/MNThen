const CACHE_NAME = 'runflow-v1.0.0';
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js'
];

// Install event
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching files');
                return cache.addAll(urlsToCache);
            })
            .then(() => {
                console.log('Service Worker: All files cached');
                return self.skipWaiting();
            })
    );
});

// Activate event
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Deleting old cache', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker: Cache cleaned');
            return self.clients.claim();
        })
    );
});

// Fetch event - Network first, then cache
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip Chrome extension requests
    if (event.request.url.startsWith('chrome-extension://')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Check if response is valid
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                // Clone the response
                const responseToCache = response.clone();

                caches.open(CACHE_NAME)
                    .then((cache) => {
                        cache.put(event.request, responseToCache);
                    });

                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(event.request)
                    .then((response) => {
                        if (response) {
                            return response;
                        }
                        
                        // If it's a navigation request and not cached, return the index.html
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                        
                        return new Response('Offline - content not available', {
                            status: 503,
                            statusText: 'Service Unavailable'
                        });
                    });
            })
    );
});

// Background sync for saving runs when back online
self.addEventListener('sync', (event) => {
    if (event.tag === 'background-sync-runs') {
        event.waitUntil(syncRuns());
    }
});

async function syncRuns() {
    try {
        const pendingRuns = JSON.parse(localStorage.getItem('runflow_pending_sync') || '[]');
        
        if (pendingRuns.length > 0) {
            // In a real app, sync with Firebase here
            console.log('Syncing pending runs:', pendingRuns);
            
            // Clear pending runs after successful sync
            localStorage.removeItem('runflow_pending_sync');
        }
    } catch (error) {
        console.error('Background sync failed:', error);
    }
}

// Handle push notifications (future feature)
self.addEventListener('push', (event) => {
    if (event.data) {
        const data = event.data.json();
        
        const options = {
            body: data.body || 'Time for your run!',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            vibrate: [200, 100, 200],
            data: data.data || {},
            actions: [
                {
                    action: 'start-run',
                    title: 'Start Run',
                    icon: '/icons/start-icon.png'
                },
                {
                    action: 'dismiss',
                    title: 'Later',
                    icon: '/icons/dismiss-icon.png'
                }
            ]
        };

        event.waitUntil(
            self.registration.showNotification(data.title || 'RunFlow', options)
        );
    }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'start-run') {
        event.waitUntil(
            clients.openWindow('/?action=start-run')
        );
    } else if (event.action === 'dismiss') {
        // Just close the notification
        return;
    } else {
        // Default action - open the app
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});
