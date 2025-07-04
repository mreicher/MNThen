const CACHE_NAME = 'mnthen-complete-v11'; // Increment cache version
const PRECACHE_VERSION = '11.0.0';

// A carefully curated list of all your critical assets to precache.
// This ensures your core application, including CSS, JS, and essential pages,
// is available offline immediately after the service worker is installed.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  
  // Essential CSS files - these must be present for core styling
  '/css/mainmap.css',
  '/css/mnthen_main_map2.css',
  
  // Essential JavaScript files
  '/locations_main.js',
  '/js/app.js',
  '/js/map.js',
  
  // Images for core UI/branding
  '/images/logo.webp',
  '/images/mnthenfav.ico',
  '/images/splash_screen.webp',
  '/images/social-share.jpg',
  '/placeholder.svg',
  
  // Other crucial assets
  '/manifest.json',
  
  // All your internal HTML pages that should work offline
  '/about.html',
  '/contact.html',
  '/locations.html',
  '/history.html',
  '/explore.html'
];

// Domains that should always be fetched from the network and NOT cached by this service worker.
// These are typically third-party analytics, APIs, CDNs for libraries you don't want to manage, etc.
const EXTERNAL_DOMAINS_TO_SKIP = [
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
  'jquery.com',
  // Add any other domains that are not part of your application's direct assets.
];

// ---------------------- Service Worker Lifecycle Events ----------------------

// Install Event: This is where we precache all the essential assets.
// It runs when the service worker is first registered or when a new version is detected.
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing Service Worker: ${CACHE_NAME}`);
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        // Using Promise.allSettled to allow some precaching to fail without stopping the whole installation.
        // This makes the installation more resilient.
        const results = await Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            try {
              // Ensure we fetch from the network during installation, bypassing any HTTP cache.
              const response = await fetch(url, { cache: 'no-cache' });
              if (!response.ok) {
                throw new Error(`Status ${response.status}`);
              }
              await cache.put(url, response);
              console.log(`[SW] Precached successfully: ${url}`);
              return { url, status: 'fulfilled' };
            } catch (error) {
              console.warn(`[SW] Failed to precache: ${url} - ${error.message}`);
              return { url, status: 'rejected', reason: error.message };
            }
          })
        );

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`[SW] Precache complete: ${successful} successful, ${failed} failed.`);

        // `self.skipWaiting()` forces the waiting service worker to become the active service worker.
        // This ensures that the new service worker activates immediately after installation,
        // without requiring the user to close all tabs to the controlled scope.
        self.skipWaiting();
      } catch (error) {
        console.error(`[SW] Installation failed: ${error}`);
      }
    })()
  );
});

// Activate Event: This is where we clean up old caches.
// It runs when the service worker becomes active.
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating Service Worker: ${CACHE_NAME}`);
  event.waitUntil(
    (async () => {
      try {
        // Get all cache names and delete those that don't match the current CACHE_NAME.
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys.map(key => {
            if (key !== CACHE_NAME) {
              console.log(`[SW] Deleting old cache: ${key}`);
              return caches.delete(key);
            }
          })
        );

        // `self.clients.claim()` allows the active service worker to take control
        // of all clients (tabs) within its scope immediately. This is crucial
        // for ensuring the new service worker handles all ongoing and future requests.
        await self.clients.claim();
        console.log('[SW] Activation complete. Clients claimed.');

        // Optionally, notify clients about the activation.
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: PRECACHE_VERSION,
            cacheName: CACHE_NAME,
          });
        });

      } catch (error) {
        console.error(`[SW] Activation failed: ${error}`);
      }
    })()
  );
});

// ------------------------ Fetch Event Handler ------------------------

// Fetch Event: This is the core of the service worker, intercepting all network requests.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Only handle GET requests for simplicity and common use cases.
  if (request.method !== 'GET') {
    return;
  }

  // 2. Skip non-HTTP(S) requests (e.g., chrome-extension://, data:).
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 3. Skip requests to external domains (CDNs, analytics, APIs that should always be fresh).
  // These will go directly to the network.
  if (isExternalDomain(url.hostname)) {
    return;
  }

  // 4. Skip development-related requests (e.g., from Vite, Webpack hot-reloading)
  // This prevents caching development-specific files that might change frequently.
  if (url.pathname.includes('__vite') || url.searchParams.has('t')) {
    return;
  }

  // At this point, the request is for an asset within our scope and from our origin (or a whitelisted one).
  // We apply different caching strategies based on the request type.
  event.respondWith(handleRequest(request));
});

// ------------------------ Helper Functions for Fetch Event ------------------------

/**
 * Determines if a given hostname belongs to an external domain that should be skipped.
 * @param {string} hostname The hostname to check.
 * @returns {boolean} True if the hostname is external and should be skipped, false otherwise.
 */
function isExternalDomain(hostname) {
  const currentOriginHostname = new URL(self.location.origin).hostname;
  
  // If the request is from the same origin, it's not an external domain.
  if (hostname === currentOriginHostname) {
    return false;
  }

  // Check if the hostname includes any of the specified external domains.
  return EXTERNAL_DOMAINS_TO_SKIP.some(domain => hostname.includes(domain));
}

/**
 * Main request handling logic, determining the caching strategy.
 * @param {Request} request The incoming fetch request.
 * @returns {Promise<Response>} A promise that resolves to a Response.
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);

  // Strategy 1: Cache-First for Precached Assets (very aggressive, ensures offline availability)
  // This is crucial for CSS files on "exit pages" – if they are precached, they will be served instantly.
  if (isPrecachedUrl(url)) {
    return cacheFirstWithNetworkUpdate(request, cache);
  }

  // Strategy 2: Network-First with Cache Fallback for other dynamic content or uncached assets.
  // This tries the network first for freshness, then falls back to cache if offline.
  // This is good for other HTML pages, dynamic JS, images, etc.
  if (request.destination === 'document' || request.destination === 'script' || request.destination === 'style' || request.destination === 'image') {
    return networkFirstWithCacheFallback(request, cache);
  }

  // Strategy 3: Network Only (or simple network request) for anything else, like APIs.
  // If it's an API, we generally want the freshest data. If network fails, it fails.
  // Consider a cache fallback for APIs if offline functionality is critical for them.
  return fetchWithTimeout(request);
}

/**
 * Checks if a given URL matches any of the precached URLs.
 * Handles common variations like trailing slashes and index.html.
 * @param {URL} url The URL object of the request.
 * @returns {boolean} True if the URL is in the precache list, false otherwise.
 */
function isPrecachedUrl(url) {
  const pathname = url.pathname;
  
  // Exact match
  if (PRECACHE_URLS.includes(pathname)) {
    return true;
  }
  // Check for index.html if pathname is '/'
  if (pathname === '/' && PRECACHE_URLS.includes('/index.html')) {
    return true;
  }
  // Check for .html extension if not present (e.g., /about -> /about.html)
  if (!pathname.endsWith('.html') && PRECACHE_URLS.includes(pathname + '.html')) {
    return true;
  }
  return false;
}

/**
 * Cache-First, then Network Update Strategy.
 * Serves from cache immediately. If successful, it then tries to fetch from the network
 * in the background to update the cache for future requests.
 * @param {Request} request The incoming fetch request.
 * @param {Cache} cache The cache instance to use.
 * @returns {Promise<Response>} A promise that resolves to a Response.
 */
async function cacheFirstWithNetworkUpdate(request, cache) {
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    console.log(`[SW] Serving from cache (Cache-First): ${request.url}`);
    
    // In the background, try to fetch a fresh version and update the cache.
    // This makes sure the user gets content quickly, but the cache stays fresh.
    event.waitUntil(
      fetchWithTimeout(request, 8000) // Shorter timeout for background update
        .then(async (networkResponse) => {
          if (networkResponse.ok) {
            console.log(`[SW] Updating cache in background: ${request.url}`);
            await cache.put(request, networkResponse.clone());
          } else {
            console.warn(`[SW] Network update failed for ${request.url}: Status ${networkResponse.status}`);
          }
        })
        .catch((error) => {
          console.warn(`[SW] Network update failed for ${request.url}: ${error.message}`);
        })
    );
    return cachedResponse;
  }

  // If not in cache (e.g., new file not precached, or cache cleared), go to network.
  console.log(`[SW] Not in cache, fetching from network: ${request.url}`);
  try {
    const networkResponse = await fetchWithTimeout(request, 10000); // Longer timeout for initial fetch
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone()); // Cache the new response
      return networkResponse;
    }
    // If network response is not OK, throw to trigger error handling or fallback.
    throw new Error(`Network response not OK: ${networkResponse.status}`);
  } catch (error) {
    console.error(`[SW] Cache-First: Network failed for ${request.url}: ${error.message}`);
    // If even the network fails, and it's a critical asset, we might want a generic fallback or the offline page.
    // For precached assets, this scenario should be rare if precaching worked.
    throw error; // Re-throw to allow default error handling or offline fallback.
  }
}

/**
 * Network-First with Cache Fallback Strategy.
 * Tries to fetch from the network first. If successful, it caches and returns the response.
 * If the network fails, it falls back to the cache.
 * @param {Request} request The incoming fetch request.
 * @param {Cache} cache The cache instance to use.
 * @returns {Promise<Response>} A promise that resolves to a Response.
 */
async function networkFirstWithCacheFallback(request, cache) {
  try {
    const networkResponse = await fetchWithTimeout(request, 10000); // Adjust timeout as needed
    if (networkResponse.ok) {
      // If the network response is good, cache it and return.
      console.log(`[SW] Serving from network (Network-First) and caching: ${request.url}`);
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    // If network response is not OK (e.g., 404, 500), but not a network error,
    // we still try the cache as a fallback for stale content.
    console.warn(`[SW] Network response not OK for ${request.url} (${networkResponse.status}). Trying cache fallback.`);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      console.log(`[SW] Serving from cache as network fallback: ${request.url}`);
      return cachedResponse;
    }
    // If network failed and no cache, throw the network response.
    return networkResponse; // Return the non-OK network response
  } catch (error) {
    // This catch block handles actual network errors (e.g., offline, timeout).
    console.log(`[SW] Network failed for ${request.url}: ${error.message}. Trying cache fallback.`);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      console.log(`[SW] Serving from cache as network fallback: ${request.url}`);
      return cachedResponse;
    }
    
    // If offline and no cached response, and it's a navigation request, serve offline page.
    if (request.destination === 'document') {
      console.log(`[SW] Serving offline.html for navigation ${request.url}`);
      const offlinePage = await cache.match('/offline.html');
      if (offlinePage) {
        return offlinePage;
      }
      // Fallback to a very basic offline response if offline.html isn't available.
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>You are Offline - MN Then</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #f0f0f0; color: #333; }
              h1 { color: #555; }
              p { margin-bottom: 20px; }
              button { background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 16px; }
              button:hover { background-color: #0056b3; }
            </style>
          </head>
          <body>
            <h1>Looks like you're offline!</h1>
            <p>Please check your internet connection and try again.</p>
            <button onclick="window.location.reload()">Reload Page</button>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }
    
    // For other asset types, if network and cache fail, just throw the error.
    console.error(`[SW] Network-First: Failed to fetch and no cache for ${request.url}`);
    throw error;
  }
}

/**
 * Fetches a request from the network with a configurable timeout.
 * @param {Request} request The Request object to fetch.
 * @param {number} timeout The timeout in milliseconds.
 * @returns {Promise<Response>} A promise that resolves to the network Response.
 * @throws {Error} If the request times out or a network error occurs.
 */
async function fetchWithTimeout(request, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms for ${request.url}`);
    }
    throw error;
  }
}

// ------------------------ Communication with Clients ------------------------

// Message Handling: Allows your web page to send messages to the Service Worker.
self.addEventListener('message', (event) => {
  // Ensure the message has data and a type.
  if (!event.data || !event.data.type) {
    return;
  }

  switch (event.data.type) {
    case 'GET_CACHE_INFO':
      getCacheInfo().then(info => {
        // Use event.ports[0] for replying to the specific sender.
        event.ports[0]?.postMessage({ type: 'CACHE_INFO', data: info });
      }).catch(error => {
        console.error('[SW] Error getting cache info:', error);
        event.ports[0]?.postMessage({ type: 'CACHE_INFO_ERROR', error: error.message });
      });
      break;

    case 'CLEAR_DYNAMIC_CACHE':
      clearDynamicCache().then(() => {
        event.ports[0]?.postMessage({ type: 'DYNAMIC_CACHE_CLEARED' });
      }).catch(error => {
        console.error('[SW] Error clearing dynamic cache:', error);
        event.ports[0]?.postMessage({ type: 'DYNAMIC_CACHE_CLEARED_ERROR', error: error.message });
      });
      break;

    case 'PRECACHE_ADDITIONAL_URLS':
      if (event.data.urls && Array.isArray(event.data.urls)) {
        precacheAdditionalUrls(event.data.urls).then(() => {
          event.ports[0]?.postMessage({ type: 'ADDITIONAL_PRECACHE_COMPLETE' });
        }).catch(error => {
          console.error('[SW] Error precaching additional URLs:', error);
          event.ports[0]?.postMessage({ type: 'ADDITIONAL_PRECACHE_ERROR', error: error.message });
        });
      } else {
        event.ports[0]?.postMessage({ type: 'ADDITIONAL_PRECACHE_ERROR', error: 'No URLs provided or invalid format.' });
      }
      break;
      
    // Add other message types as needed for specific actions (e.g., 'SKIP_WAITING').
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});

/**
 * Retrieves information about the current cache.
 * @returns {Promise<Object>} An object containing cache version, total files, and precached files count.
 */
async function getCacheInfo() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  return {
    version: PRECACHE_VERSION,
    cacheName: CACHE_NAME,
    totalCachedFiles: keys.length,
    precachedFilesCount: PRECACHE_URLS.length,
  };
}

/**
 * Clears items from the current cache that are NOT part of the initial PRECACHE_URLS list.
 * This is useful for clearing dynamically cached content without affecting the core app.
 */
async function clearDynamicCache() {
  const cache = await caches.open(CACHE_NAME);
  const cachedRequests = await cache.keys(); // Get all requests currently in the cache

  const deletePromises = cachedRequests.map(async (request) => {
    const url = new URL(request.url);
    // Only delete if the URL is NOT in our static precache list.
    if (!isPrecachedUrl(url)) {
      console.log(`[SW] Deleting dynamic cache entry: ${url.pathname}`);
      return cache.delete(request);
    }
    return Promise.resolve(); // Do nothing if it's a precached file
  });

  await Promise.all(deletePromises);
  console.log('[SW] Dynamic cache cleared successfully.');
}

/**
 * Adds additional URLs to the cache dynamically. Useful for caching content
 * that might be discovered later (e.g., from an API response).
 * @param {string[]} urls An array of URLs to cache.
 */
async function precacheAdditionalUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      try {
        // Ensure we don't try to cache external domains here.
        if (isExternalDomain(new URL(url).hostname)) {
          console.warn(`[SW] Skipping precache of external URL: ${url}`);
          return { url, status: 'rejected', reason: 'External domain' };
        }
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }
        await cache.put(url, response);
        console.log(`[SW] Precached additional URL: ${url}`);
        return { url, status: 'fulfilled' };
      } catch (error) {
        console.warn(`[SW] Failed to precache additional URL: ${url} - ${error.message}`);
        return { url, status: 'rejected', reason: error.message };
      }
    })
  );
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`[SW] Additional precache complete: ${successful} successful, ${failed} failed.`);
}

console.log(`[SW] Service Worker script loaded. Current Cache Name: ${CACHE_NAME}`);
