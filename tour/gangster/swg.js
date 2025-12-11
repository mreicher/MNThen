// swg.js – Minnesota Then Service Worker
// Version: 4.4.5 – Complete Rewrite
// FOR: Gangster Tour App

/**
 * CONFIGURATION
 * Single source of truth for versioning and cache policies
 */
const SW_CONFIG = Object.freeze({
  VERSION: '4.4.5',
  LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'
  CACHE_LIMITS: {
    STATIC: { name: 'mnthen-static', maxEntries: 50, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    TILES: { name: 'mnthen-tiles', maxEntries: 1500, maxAge: 14 * 24 * 60 * 60 * 1000 }, // 14 days
    DATA: { name: 'mnthen-data', maxEntries: 50, maxAge: 1 * 24 * 60 * 60 * 1000 }, // 1 day
    AUDIO: { name: 'mnthen-audio', maxEntries: 100, maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
    IMAGES: { name: 'mnthen-images', maxEntries: 100, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
  }
});

/**
 * UTILITY FUNCTIONS
 */
const Logger = {
  debug: (...args) => SW_CONFIG.LOG_LEVEL === 'debug' && console.debug('[SW]', ...args),
  info: (...args) => ['debug', 'info'].includes(SW_CONFIG.LOG_LEVEL) && console.info('[SW]', ...args),
  warn: (...args) => ['debug', 'info', 'warn'].includes(SW_CONFIG.LOG_LEVEL) && console.warn('[SW]', ...args),
  error: (...args) => console.error('[SW]', ...args),
};

/**
 * Creates cache name with version
 */
function getCacheName(base) {
  return `${SW_CONFIG.CACHE_LIMITS[base].name}-v1-${SW_CONFIG.VERSION}`;
}

/**
 * Robust URL matchers
 */
const URLMatchers = {
  isTile: (url) => {
    try {
      const { hostname, pathname } = new URL(url);
      return TILE_DOMAINS.includes(hostname) || TILE_REGEX.test(pathname);
    } catch {
      return false;
    }
  },
  isAudio: (url) => AUDIO_EXTENSIONS.test(url),
  isImage: (url) => /\.(jpg|jpeg|png|gif|svg|webp|ico)$/i.test(url),
  isStatic: (url) => /\.(css|js|woff|woff2|ttf|eot)$/i.test(url),
  isDocument: (request) => request.destination === 'document',
  isData: (url) => url.includes('/locations_h.js'),
};

const TILE_DOMAINS = ['a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org'];
const TILE_REGEX = /^\/\d+\/\d+\/\d+\.png$/;
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i;

/**
 * CACHE MANAGEMENT
 * Advanced cache management with size, age, and count limits
 */
class CacheManager {
  constructor() {
    this.cleanupPromise = null;
  }

  /**
   * Clean up old/expired entries from a specific cache
   */
  async cleanup(cacheName, maxEntries, maxAge) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      if (keys.length <= maxEntries && !maxAge) {
        Logger.debug(`Cache ${cacheName} within limits (${keys.length}/${maxEntries})`);
        return;
      }

      // Sort by date (oldest first)
      const keyedWithDates = await Promise.all(
        keys.map(async (key) => {
          const response = await cache.match(key);
          const date = response?.headers.get('date');
          return { key, date: date ? new Date(date).getTime() : 0 };
        })
      );

      const now = Date.now();
      const toDelete = keyedWithDates
        .filter(({ date }) => maxAge && (now - date) > maxAge)
        .map(({ key }) => key);

      // If still over limit, delete oldest by count
      if (keys.length - toDelete.length > maxEntries) {
        const remaining = keyedWithDates
          .filter(item => !toDelete.includes(item.key))
          .sort((a, b) => a.date - b.date);
        
        const excess = remaining.slice(0, keys.length - toDelete.length - maxEntries);
        toDelete.push(...excess.map(({ key }) => key));
      }

      if (toDelete.length > 0) {
        await Promise.all(toDelete.map(key => cache.delete(key)));
        Logger.info(`Cleaned ${toDelete.length} entries from ${cacheName}`);
      }
    } catch (e) {
      Logger.warn(`Cache cleanup failed for ${cacheName}:`, e);
    }
  }

  /**
   * Queue cleanup to prevent concurrent operations
   */
  async scheduleCleanup(cacheName, maxEntries, maxAge) {
    if (this.cleanupPromise) {
      await this.cleanupPromise;
    }
    this.cleanupPromise = this.cleanup(cacheName, maxEntries, maxAge);
    await this.cleanupPromise;
    this.cleanupPromise = null;
  }
}

const cacheManager = new CacheManager();

/**
 * STRATEGIES
 * Different caching strategies for different resource types
 */

/**
 * Stale-while-revalidate strategy (optimal for tiles)
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  // Revalidate in background
  const revalidate = async () => {
    try {
      const fresh = await fetch(request, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-cache'
      });
      
      if (fresh.ok && fresh.status === 200) {
        await cache.put(request, fresh.clone());
        await cacheManager.scheduleCleanup(
          cacheName,
          SW_CONFIG.CACHE_LIMITS.TILES.maxEntries,
          SW_CONFIG.CACHE_LIMITS.TILES.maxAge
        );
      }
    } catch (e) {
      Logger.debug('Background revalidation failed:', e);
    }
  };

  // Return cached immediately if available
  if (cached) {
    revalidate(); // Fire and forget
    return cached;
  }

  // No cache, fetch and cache
  try {
    const response = await fetch(request, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-cache'
    });

    if (response.ok && response.status === 200) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    Logger.warn('Fetch failed, no fallback available:', e);
    return new Response(null, { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Cache-first with fallback (for static assets)
 */
async function cacheFirst(request, cacheName, fallback) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
      Logger.debug(`Cache hit: ${request.url}`);
      return cached;
    }

    Logger.debug(`Cache miss, fetching: ${request.url}`);
    const response = await fetch(request);

    if (response.ok && response.status === 200 && response.type !== 'opaque') {
      await cache.put(request, response.clone());
      await cacheManager.scheduleCleanup(
        cacheName,
        SW_CONFIG.CACHE_LIMITS[Object.keys(SW_CONFIG.CACHE_LIMITS).find(k => 
          SW_CONFIG.CACHE_LIMITS[k].name === cacheName.replace(/-v1-.*$/, '')
        )].maxEntries,
        SW_CONFIG.CACHE_LIMITS[Object.keys(SW_CONFIG.CACHE_LIMITS).find(k => 
          SW_CONFIG.CACHE_LIMITS[k].name === cacheName.replace(/-v1-.*$/, '')
        )].maxAge
      );
    }

    return response;
  } catch (e) {
    Logger.warn(`Fetch failed for ${request.url}:`, e);
    
    if (fallback) {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(fallback);
      if (cached) return cached;
    }

    // Return generic offline response
    const isHTML = request.headers.get('accept')?.includes('text/html');
    return new Response(
      isHTML 
        ? '<h1>Offline</h1><p>Please connect to the internet to continue.</p>' 
        : null,
      { 
        status: 503, 
        statusText: 'Service Unavailable',
        headers: isHTML ? { 'Content-Type': 'text/html' } : {}
      }
    );
  }
}

/**
 * Network-first (for data and documents)
 */
async function networkFirst(request, cacheName) {
  try {
    Logger.debug(`Network first: ${request.url}`);
    const response = await fetch(request, {
      cache: 'no-cache',
      mode: 'cors'
    });

    if (response.ok && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
      await cacheManager.scheduleCleanup(
        cacheName,
        SW_CONFIG.CACHE_LIMITS[Object.keys(SW_CONFIG.CACHE_LIMITS).find(k => 
          SW_CONFIG.CACHE_LIMITS[k].name === cacheName.replace(/-v1-.*$/, '')
        )].maxEntries,
        SW_CONFIG.CACHE_LIMITS[Object.keys(SW_CONFIG.CACHE_LIMITS).find(k => 
          SW_CONFIG.CACHE_LIMITS[k].name === cacheName.replace(/-v1-.*$/, '')
        )].maxAge
      );
    }

    return response;
  } catch (e) {
    Logger.warn(`Network failed, trying cache: ${request.url}`, e);
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
      Logger.info(`Serving cached version: ${request.url}`);
      return cached;
    }

    return new Response(null, { status: 503, statusText: 'Network Unavailable' });
  }
}

/**
 * Specialized tile handling with timeout and fallback
 */
async function handleTileRequest(request) {
  const cacheName = getCacheName('TILES');
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Return cached immediately
    staleWhileRevalidate(request, cacheName); // Background update
    return cached;
  }

  // No cache - fetch with timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const cleanRequest = new Request(request.url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'default',
      signal: controller.signal
    });

    const response = await fetch(cleanRequest);
    clearTimeout(timeoutId);

    if (response.ok && response.status === 200) {
      await cache.put(request, response.clone());
      return response;
    }

    throw new Error(`Invalid response: ${response.status}`);
  } catch (e) {
    Logger.warn('Tile fetch failed, using fallback:', e);
    // Return transparent 1x1 PNG
    const fallbackData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    return new Response(
      Uint8Array.from(atob(fallbackData), c => c.charCodeAt(0)),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
          'X-SW-Fallback': 'true'
        }
      }
    );
  }
}

/**
 * Media request handler with proper range support
 */
async function handleMediaRequest(request) {
  const cacheName = getCacheName('AUDIO');
  
  // For range requests, always go to network
  if (request.headers.has('range')) {
    Logger.debug('Range request for media, bypassing cache');
    return fetch(request, { 
      cache: 'no-cache', 
      mode: 'cors',
      credentials: 'omit'
    });
  }

  // Normal request - use cache-first
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
      Logger.debug(`Media cache hit: ${request.url}`);
      return cached;
    }

    Logger.debug(`Media cache miss, fetching: ${request.url}`);
    const response = await fetch(request, { 
      mode: 'cors',
      credentials: 'omit'
    });

    if (response.ok && response.status === 200 && response.type !== 'opaque') {
      // Clone to avoid consuming the stream
      const clone = response.clone();
      // Cache in background without blocking
      cache.put(request, clone).catch(e => {
        Logger.warn('Media caching failed:', e);
      });
    }

    return response;
  } catch (e) {
    Logger.error('Media fetch failed:', e);
    return new Response(null, { status: 503, statusText: 'Media Unavailable' });
  }
}

/**
 * Precache critical resources during installation
 */
async function precacheCritical() {
  const criticalResources = [
    '/', // Root HTML
    '/locations_h.js', // Tour data
    // Add other critical resources here
  ];

  try {
    const cache = await caches.open(getCacheName('STATIC'));
    const results = await Promise.allSettled(
      criticalResources.map(url => 
        fetch(url, { mode: 'cors', credentials: 'omit' })
          .then(response => {
            if (response.ok && response.status === 200) {
              return cache.put(url, response);
            }
            throw new Error(`Failed to precache ${url}: ${response.status}`);
          })
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    Logger.info(`Precached ${successful}/${criticalResources.length} resources`);
  } catch (e) {
    Logger.warn('Precaching failed:', e);
    // Non-critical, don't block installation
  }
}

/**
 * MESSAGE HANDLER
 * Handle messages from main thread
 */
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      Logger.info('Message: SKIP_WAITING');
      self.skipWaiting();
      break;

    case 'PRECACHE_AUDIO':
      Logger.info('Message: PRECACHE_AUDIO', payload?.urls?.length || 0, 'urls');
      if (payload?.urls) {
        // Precache audio in background
        event.waitUntil(
          caches.open(getCacheName('AUDIO')).then(async cache => {
            const promises = payload.urls.map(async url => {
              try {
                const cached = await cache.match(url);
                if (!cached) {
                  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
                  if (response.ok && response.status === 200) {
                    await cache.put(url, response);
                    Logger.debug(`Precached audio: ${url}`);
                  }
                }
              } catch (e) {
                Logger.warn(`Failed to precache audio ${url}:`, e);
              }
            });
            await Promise.allSettled(promises);
          })
        );
      }
      break;

    case 'CLEAR_CACHE':
      Logger.info('Message: CLEAR_CACHE', payload?.type || 'all');
      event.waitUntil(
        caches.keys().then(names => 
          Promise.all(
            names.map(name => {
              if (!payload?.type || name.includes(payload.type)) {
                Logger.info('Deleting cache:', name);
                return caches.delete(name);
              }
            })
          ).then(() => {
            event.ports?.[0]?.postMessage({ success: true });
          })
        )
      );
      break;

    case 'GET_CACHE_INFO':
      Logger.info('Message: GET_CACHE_INFO');
      event.waitUntil(
        caches.keys().then(async names => {
          const info = await Promise.all(
            names.map(async name => {
              const cache = await caches.open(name);
              const keys = await cache.keys();
              return { name, entries: keys.length };
            })
          );
          event.ports?.[0]?.postMessage(info);
        })
      );
      break;

    default:
      Logger.warn('Unknown message type:', type);
  }
});

/**
 * FETCH HANDLER
 * Main request routing logic
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Skip non-GET requests
  if (request.method !== 'GET') {
    Logger.debug('Skipping non-GET request:', request.method, url);
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.startsWith('http')) {
    Logger.debug('Skipping non-HTTP request:', url);
    return;
  }

  // Route based on resource type
  try {
    if (URLMatchers.isDocument(request)) {
      // HTML documents - network first
      event.respondWith(networkFirst(request, getCacheName('DATA')));
      return;
    }

    if (URLMatchers.isTile(url)) {
      // Map tiles - stale-while-revalidate
      event.respondWith(handleTileRequest(request));
      return;
    }

    if (URLMatchers.isAudio(url)) {
      // Audio files - cache-first with range support
      event.respondWith(handleMediaRequest(request));
      return;
    }

    if (URLMatchers.isData(url)) {
      // Tour data - network first
      event.respondWith(networkFirst(request, getCacheName('DATA')));
      return;
    }

    if (URLMatchers.isImage(url)) {
      // Images - cache-first
      event.respondWith(cacheFirst(request, getCacheName('IMAGES')));
      return;
    }

    if (URLMatchers.isStatic(url)) {
      // CSS, JS, fonts - cache-first
      event.respondWith(cacheFirst(request, getCacheName('STATIC')));
      return;
    }

    // Default - network first
    Logger.debug('Using default network-first strategy:', url);
    event.respondWith(networkFirst(request, getCacheName('DATA')));
  } catch (e) {
    Logger.error('Fetch handler error:', e);
    event.respondWith(new Response(null, { status: 500 }));
  }
});

/**
 * LIFECYCLE EVENTS
 */
self.addEventListener('install', (event) => {
  Logger.info(`Installing SW v${SW_CONFIG.VERSION}`);
  
  // Precache critical resources in background
  event.waitUntil(
    Promise.all([
      precacheCritical(),
      self.skipWaiting()
    ])
  );
});

self.addEventListener('activate', (event) => {
  Logger.info(`Activating SW v${SW_CONFIG.VERSION}`);
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(names => 
        Promise.all(
          names.map(name => {
            // Delete old version caches
            if (!name.endsWith(`-v1-${SW_CONFIG.VERSION}`)) {
              Logger.info('Deleting old cache:', name);
              return caches.delete(name);
            }
          })
        )
      ),
      // Clean up all caches
      Promise.all(
        Object.entries(SW_CONFIG.CACHE_LIMITS).map(([type, config]) => 
          cacheManager.scheduleCleanup(
            getCacheName(type),
            config.maxEntries,
            config.maxAge
          )
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('error', (event) => {
  Logger.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  Logger.error('Unhandled promise rejection:', event.reason);
});

Logger.info(`SW v${SW_CONFIG.VERSION} loaded successfully`);
