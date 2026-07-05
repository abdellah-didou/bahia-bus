'use strict';

// Bahia Bus service worker.
//
// Flutter 3.44's generated service worker deliberately unregisters itself (the
// framework dropped built-in offline caching). This replaces it with a small,
// conservative runtime cache so the app opens offline and — the point of this
// file — Mapbox tiles the user has already viewed stay available with no signal.
//
// Strategy:
//   * Mapbox tiles  -> cache-first (tiles are immutable), background-fill, capped.
//   * App shell     -> stale-while-revalidate (opens instantly/offline, but always
//                      refreshes in the background so updates land next launch).
// Bump the *_VERSION strings to force a clean cache rollover after a change.

const APP_CACHE = 'bb-app-v1';
const TILE_CACHE = 'bb-tiles-v1';
const TILE_MAX = 1200; // ~ tens of MB of tiles; oldest evicted past this

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([APP_CACHE, TILE_CACHE]);
    for (const key of await caches.keys()) {
      if (!keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }

  // Mapbox tiles / styles: cache-first, fill in the background, keep offline.
  if (url.hostname === 'api.mapbox.com') {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const resp = await fetch(req);
        if (resp && resp.status === 200) {
          cache.put(req, resp.clone());
          trimCache(cache, TILE_MAX);
        }
        return resp;
      } catch (_) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Same-origin app files: serve from cache immediately, refresh in background.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200) cache.put(req, resp.clone());
        return resp;
      }).catch(() => null);
      return hit || (await network) || Response.error();
    })());
  }
});

async function trimCache(cache, max) {
  const keys = await cache.keys();
  const excess = keys.length - max;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}
