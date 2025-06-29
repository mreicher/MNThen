const CACHE_NAME = 'mnthen-v3';
const OFFLINE_CACHE = 'mnthen-offline-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  '/images/logo.webp',
  '/images/mnthenfav.ico',
  '/images/splash_screen.webp',
  '/locations_main.js',
  '/manifest.json',
  '/placeholder.svg'
];

// Cache strategies
const STRATEGIES = {
  NETWORK_FIRST: 'network-first',
  CACHE_FIRST: 'cache-first',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
  CACHE_ONLY: 'cache-only'
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, OFFLINE_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!currentCaches.includes(cacheName)) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Send message to all clients to inform about SW activation
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: 'v3'
          });
        });
      });
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === location.origin;
  
  // Skip non-GET requests and chrome-extension URLs
  if (event.request.method !== 'GET' || requestUrl.protocol === 'chrome-extension:') {
    return;
  }

  // Handle API requests differently
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(event));
    return;
  }

  // Handle image requests with cache-first strategy
  if (requestUrl.pathname.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    event.respondWith(handleImageRequest(event));
    return;
  }

  // Handle audio requests with stale-while-revalidate
  if (requestUrl.pathname.match(/\.(mp3|ogg|wav)$/i)) {
    event.respondWith(handleAudioRequest(event));
    return;
  }

  // Default network-first strategy for same-origin HTML
  if (isSameOrigin && event.request.headers.get('accept').includes('text/html')) {
    event.respondWith(handleHtmlRequest(event));
    return;
  }

  // For all other requests, use network-first strategy
  event.respondWith(handleDefaultRequest(event));
});

async function handleApiRequest(event) {
  try {
    const networkResponse = await fetch(event.request);
    return networkResponse;
  } catch (error) {
    return Response.json({ error: 'Network error' }, { status: 503 });
  }
}

async function handleImageRequest(event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(event.request);
  
  if (cachedResponse) {
    // Update cache in background
    event.waitUntil(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok) {
          return cache.put(event.request, networkResponse.clone());
        }
      }).catch(() => {})
    );
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      await cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Return offline placeholder if available
    const offlineResponse = await cache.match('/placeholder.svg');
    return offlineResponse || Response.error();
  }
}

async function handleAudioRequest(event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(event.request);
  
  // Return cached response immediately if available
  if (cachedResponse) {
    // Update cache in background
    event.waitUntil(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok) {
          return cache.put(event.request, networkResponse.clone());
        }
      }).catch(() => {})
    );
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      await cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    return Response.error();
  }
}

async function handleHtmlRequest(event) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      await cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await cache.match(event.request);
    return cachedResponse || (await cache.match('/offline.html')) || Response.error();
  }
}

async function handleDefaultRequest(event) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      await cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await cache.match(event.request);
    return cachedResponse || Response.error();
  }
}

self.addEventListener('message', (event) => {
  if (event.data.type === 'PREFETCH_AUDIO') {
    const { userLocation, locations } = event.data.data;
    prefetchNearbyAudio(userLocation, locations);
  }
});

async function prefetchNearbyAudio(userLocation, locations) {
  if (!userLocation || !locations || !Array.isArray(locations)) return;
  
  // Find the closest 3 locations
  const locationsWithDistance = locations.map(loc => {
    const distance = calculateDistance(userLocation, loc);
    return { ...loc, distance };
  }).filter(loc => loc.audio); // Only locations with audio
  
  // Sort by distance and take the closest 3
  const closestLocations = locationsWithDistance
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);
  
  const cache = await caches.open(CACHE_NAME);
  
  // Prefetch audio files for closest locations
  closestLocations.forEach(async (location) => {
    try {
      const response = await fetch(location.audio);
      if (response.ok) {
        await cache.put(location.audio, response.clone());
      }
    } catch (error) {
      console.log('Failed to prefetch audio:', location.audio, error);
    }
  });
}

function calculateDistance(pos1, pos2) {
  if (!pos1 || !pos2 || 
      typeof pos1.lat !== 'number' || typeof pos1.lng !== 'number' || 
      typeof pos2.lat !== 'number' || typeof pos2.lng !== 'number') {
    return Infinity;
  }
  
  // Haversine formula implementation
  const R = 6371000; // Earth's radius in meters
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
