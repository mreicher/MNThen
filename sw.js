// Minimal service worker - does nothing but register successfully
console.log('SW: Minimal service worker loaded');

self.addEventListener('install', event => {
  console.log('SW: Installing (no-op)');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('SW: Activating (no-op)');
  self.clients.claim();
});

// Don't intercept any fetch requests - let everything go through normally
self.addEventListener('fetch', event => {
  // Do nothing - let the browser handle all requests normally
});
