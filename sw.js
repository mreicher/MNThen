// Minimal service worker - now handles audio CORS issues
console.log('SW: Minimal service worker loaded');

self.addEventListener('install', event => {
  console.log('SW: Installing (no-op)');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('SW: Activating (no-op)');
  self.clients.claim();
});

// Intercept fetch requests for audio files
self.addEventListener('fetch', event => {
  // Check if this is an audio request
  if (event.request.url.includes('/audio/') || 
      event.request.url.match(/\.(mp3|wav|ogg|m4a)$/i)) {
    
    event.respondWith(
      fetch(event.request, {
        mode: 'cors',
        credentials: 'omit'
      })
      .then(response => {
        // Clone the response so we can modify headers
        const newResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: {
            ...Object.fromEntries(response.headers.entries()),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Cross-Origin-Resource-Policy': 'cross-origin'
          }
        });
        return newResponse;
      })
      .catch(error => {
        console.error('SW: Audio fetch failed:', error);
        return new Response('Audio fetch failed', { status: 500 });
      })
    );
  }
  // Let all other requests go through normally
});
