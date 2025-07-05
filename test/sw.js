// service-worker.js
const IMAGE_CACHE = 'mnthen-images-v1';
const AUDIO_CACHE = 'mnthen-audio-v1';
const MAP_TILES_CACHE = 'mnthen-tiles-v1';

// Cache size limits (in MB)
const CACHE_LIMITS = {
  [IMAGE_CACHE]: 50 * 1024 * 1024,  // 50MB
  [AUDIO_CACHE]: 100 * 1024 * 1024, // 100MB
  [MAP_TILES_CACHE]: 75 * 1024 * 1024 // 75MB
};

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [IMAGE_CACHE, AUDIO_CACHE, MAP_TILES_CACHE];
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Only cache specific resource types
  if (isImageRequest(url) || isAudioRequest(url) || isMapTileRequest(url)) {
    event.respondWith(handleCacheableRequest(event.request));
  }
  // Let everything else pass through normally
});

// Check if request is for an image
function isImageRequest(url) {
  return url.pathname.includes('/images/') || 
         url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
}

// Check if request is for audio
function isAudioRequest(url) {
  return url.pathname.includes('/audio/') || 
         url.pathname.match(/\.(mp3|wav|ogg|m4a)$/i);
}

// Check if request is for map tiles
function isMapTileRequest(url) {
  return url.hostname.includes('tile.openstreetmap.org') ||
         url.hostname.includes('tiles.') ||
         (url.pathname.match(/\/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/));
}

// Handle cacheable requests with cache-first strategy
async function handleCacheableRequest(request) {
  const cacheName = getCacheName(request);
  
  try {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback to network
    const networkResponse = await fetch(request);
    
    // Cache the response if successful
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
      
      // Clean up cache if it's getting too large
      await cleanupCache(cacheName);
    }
    
    return networkResponse;
  } catch (error) {
    // If both cache and network fail, return a basic fallback
    return createFallbackResponse(request);
  }
}

// Determine appropriate cache based on request type
function getCacheName(request) {
  const url = new URL(request.url);
  
  if (isImageRequest(url)) {
    return IMAGE_CACHE;
  }
  
  if (isAudioRequest(url)) {
    return AUDIO_CACHE;
  }
  
  if (isMapTileRequest(url)) {
    return MAP_TILES_CACHE;
  }
  
  return IMAGE_CACHE; // fallback
}

// Clean up cache if it exceeds size limit
async function cleanupCache(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > 100) { // Simple cleanup - remove oldest entries
    const oldestKeys = keys.slice(0, 20);
    await Promise.all(oldestKeys.map(key => cache.delete(key)));
  }
}

// Create fallback response for failed requests
function createFallbackResponse(request) {
  const url = new URL(request.url);
  
  if (isImageRequest(url)) {
    return new Response(
      '<svg width="200" height="150" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f0f0f0"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#666">Image unavailable</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  
  // For audio and map tiles, just let the request fail naturally
  return new Response('Resource not available', {
    status: 503,
    statusText: 'Service Unavailable'
  });
}

// Handle messages from the client for audio prefetching
self.addEventListener('message', (event) => {
  if (event.data.type === 'PREFETCH_AUDIO') {
    prefetchNearbyAudio(event.data.data);
  }
});

// Prefetch audio files for nearby locations
async function prefetchNearbyAudio(data) {
  if (!data || !data.userLocation || !data.locations) return;
  
  const cache = await caches.open(AUDIO_CACHE);
  const MAX_DISTANCE = 1000; // meters
  
  // Filter nearby locations
  const nearbyLocations = data.locations.filter(location => {
    if (!location.audio || !location.lat || !location.lng) return false;
    
    const distance = calculateDistance(
      { lat: data.userLocation.lat, lng: data.userLocation.lng },
      { lat: location.lat, lng: location.lng }
    );
    
    return distance <= MAX_DISTANCE;
  });
  
  // Prefetch audio files (max 5 at a time to avoid overwhelming)
  const limitedLocations = nearbyLocations.slice(0, 5);
  
  for (const location of limitedLocations) {
    try {
      const audioUrl = location.audio;
      if (!audioUrl) continue;
      
      // Check if already cached
      const cached = await cache.match(audioUrl);
      if (cached) continue;
      
      // Fetch and cache
      const response = await fetch(audioUrl);
      if (response.ok) {
        await cache.put(audioUrl, response.clone());
      }
    } catch (error) {
      // Silent fail for prefetch
    }
  }
}

// Helper function to calculate distance between coordinates
function calculateDistance(pos1, pos2) {
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
