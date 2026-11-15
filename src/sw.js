// Offline shell. The version and file list are filled in by the build
// (see vite.config.js); this file is not used as written.
const APP_VERSION = "__APP_VERSION__";
const SHELL_FILES = "__SHELL_FILES__";
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = "coinboard:" + SCOPE.pathname + ":";
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;
const INDEX_URL = new URL("index.html", SCOPE).href;
const SHELL_URLS = SHELL_FILES.map(function (path) { return new URL(path, SCOPE).href; });

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "GET_APP_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: "APP_VERSION", cacheName: CACHE_NAME });
  }
});
self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS.map(function (url) { return new Request(url, { cache: "reload" }); }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.map(function (name) {
      return name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME ? caches.delete(name) : null;
    }));
    await self.clients.claim();
  })());
});
// Coin icons come from a CDN. Each one is kept after its first download so a
// board showing another coin still has its icon when offline. This cache is
// not tied to the app version.
const ICON_CACHE = "coinboard-icons:v1";
const ICON_ORIGIN = "https://cdn.jsdelivr.net";
const ICON_PATH = "/npm/cryptocurrency-icons@";

async function fromCache(cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(cacheKey);
}
// Everything in the shell was stored when this version was installed, as one
// consistent set. Serving it from there makes the board start at once, online
// or not. A new release is a new worker with its own cache; the page notices
// the takeover and reloads itself (see src/lib/updater.js).
async function cacheFirst(request, cacheKey) {
  return (await fromCache(cacheKey)) || fetch(request);
}
async function iconFirst(request) {
  const cache = await caches.open(ICON_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  // Only a real icon is worth keeping; a 404 means the coin has none.
  if (response.ok) await cache.put(request.url, response.clone()).catch(function () {});
  return response;
}
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === ICON_ORIGIN && url.pathname.startsWith(ICON_PATH)) { event.respondWith(iconFirst(request)); return; }
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const isAppHTML = url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname;
  // Root and index share one stored page, including navigation query strings.
  if (isAppHTML) event.respondWith(cacheFirst(request, INDEX_URL));
  else if (SHELL_URLS.includes(url.href)) event.respondWith(cacheFirst(request, url.href));
  // Live market sockets are never stored.
});
