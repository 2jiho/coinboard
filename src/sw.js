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
async function fromCache(cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(cacheKey);
}
// The page itself: always try the network so a new release is seen at once.
async function networkFirst(request, cacheKey, event) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 5000);
  try {
    const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error("Shell HTTP " + response.status);
    // Cache storage must not prevent delivery of a successful online response.
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
      return cache.put(cacheKey, copy);
    }).catch(function (error) { console.warn("Offline cache write failed:", error); }));
    return response;
  } catch (error) {
    const cached = await fromCache(cacheKey);
    if (cached) return cached;
    throw error;
  } finally { clearTimeout(timeout); }
}
// Built assets carry a content hash in their name, so a cached copy is exact.
async function cacheFirst(request, cacheKey) {
  return (await fromCache(cacheKey)) || fetch(request);
}
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const isAppHTML = url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname;
  if (isAppHTML) {
    // Root and index share one offline copy, including navigation query strings.
    event.respondWith(networkFirst(request, INDEX_URL, event));
  } else if (SHELL_URLS.includes(url.href)) {
    event.respondWith(cacheFirst(request, url.href));
  }
  // Live market sockets and remote icons are never stored in this cache.
});
