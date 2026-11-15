// Registers the service worker, reports the cache version it serves, and
// applies new versions: automatically on an idle board, on panel close if the
// settings panel is open.
const RELOAD_KEY = "coinboard-auto-reload";
const CHECK_MS = 3600000;

export function createUpdater(options) {
  const navigator = options.navigator, document = options.document, storage = options.storage;
  const onCacheVersion = options.onCacheVersion || (() => {});
  const onUpdateReady = options.onUpdateReady || (() => {});
  let reloadPending = false, pendingVersion = null;

  // Ask the controlling worker which cache it serves. A worker that has just
  // taken over can be slow to answer, so ask up to three times; null if it
  // never says.
  function queryCacheVersion(done, attempt) {
    attempt = attempt || 1;
    const worker = navigator.serviceWorker.controller;
    if (!worker) { done(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      if (attempt < 3) queryCacheVersion(done, attempt + 1); else done(null);
    }, options.queryTimeoutMs || 1500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer); channel.port1.close();
      const cache = event.data && event.data.cacheName;
      done(typeof cache === "string" ? cache.split(":").pop() : null);
    };
    worker.postMessage({ type: "GET_APP_VERSION" }, [channel.port2]);
  }
  // The installed offline copy, reported as a state and a version; how to word
  // it is the page's business.
  //   unsupported: no service workers here      waiting: none in control yet
  //   unknown: the worker would not say         known: version holds it
  function showCacheVersion(done) {
    if (!("serviceWorker" in navigator)) { onCacheVersion({ state: "unsupported", version: null }); return; }
    if (!navigator.serviceWorker.controller) { onCacheVersion({ state: "waiting", version: null }); return; }
    queryCacheVersion((cacheVersion) => {
      onCacheVersion(cacheVersion ? { state: "known", version: cacheVersion } : { state: "unknown", version: null });
      if (done) done(cacheVersion);
    });
  }
  // One automatic reload per new version per browser session. If the same
  // version asks again, something is wrong: leave it to the button.
  function mayAutoReload(cacheVersion) {
    if (!storage || !cacheVersion) return false;
    try {
      if (storage.getItem(RELOAD_KEY) === cacheVersion) return false;
      storage.setItem(RELOAD_KEY, cacheVersion);
      return true;
    } catch (error) { return false; }
  }
  function applyUpdate(cacheVersion) {
    // A replacement worker serving this page's own version has nothing newer.
    if (cacheVersion === options.version) return;
    onUpdateReady();
    if (options.isSettingsOpen()) { reloadPending = true; return; }
    if (mayAutoReload(cacheVersion)) options.location.reload();
  }
  function start() {
    showCacheVersion();
    if (!("serviceWorker" in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const isUpdate = hadController;
      hadController = true;
      showCacheVersion((cacheVersion) => {
        pendingVersion = cacheVersion;
        if (isUpdate) applyUpdate(cacheVersion);
      });
    });
    navigator.serviceWorker.register(options.workerUrl, { updateViaCache: "none" }).then((registration) => {
      function checkUpdate() {
        if (document.visibilityState !== "visible") return;
        registration.update().catch((error) => { console.warn("업데이트 확인 실패:", error); });
      }
      checkUpdate();
      options.clock.setInterval(checkUpdate, CHECK_MS);
      document.addEventListener("visibilitychange", checkUpdate);
      // A board that was offline may have missed a release.
      if (options.window) options.window.addEventListener("online", checkUpdate);
    }).catch((error) => { console.warn("Service Worker 등록 실패:", error); });
  }
  return {
    start,
    reload() { options.location.reload(); },
    // Call when the settings panel closes: a waiting update applies now.
    settingsClosed() {
      if (!reloadPending) return;
      reloadPending = false;
      if (mayAutoReload(pendingVersion)) options.location.reload();
    },
  };
}
