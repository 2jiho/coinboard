// Registers the service worker, reports the cache version it serves, and
// applies new versions: automatically on an idle board, on panel close if the
// settings panel is open.
var RELOAD_KEY = "coinboard-auto-reload";
var CHECK_MS = 3600000;

export function createUpdater(options) {
  var navigator = options.navigator, document = options.document, storage = options.storage;
  var onCacheVersion = options.onCacheVersion || function () {};
  var onUpdateReady = options.onUpdateReady || function () {};
  var reloadPending = false, pendingVersion = null;

  // Ask the controlling worker which cache it serves. A worker that has just
  // taken over can be slow to answer, so ask up to three times; null if it
  // never says.
  function queryCacheVersion(done, attempt) {
    attempt = attempt || 1;
    var worker = navigator.serviceWorker.controller;
    if (!worker) { done(null); return; }
    var channel = new MessageChannel();
    var timer = setTimeout(function () {
      channel.port1.close();
      if (attempt < 3) queryCacheVersion(done, attempt + 1); else done(null);
    }, options.queryTimeoutMs || 1500);
    channel.port1.onmessage = function (event) {
      clearTimeout(timer); channel.port1.close();
      var cache = event.data && event.data.cacheName;
      done(typeof cache === "string" ? cache.split(":").pop() : null);
    };
    worker.postMessage({ type: "GET_APP_VERSION" }, [channel.port2]);
  }
  function showCacheVersion(done) {
    if (!("serviceWorker" in navigator)) { onCacheVersion("미지원"); return; }
    if (!navigator.serviceWorker.controller) { onCacheVersion("대기"); return; }
    queryCacheVersion(function (cacheVersion) {
      onCacheVersion(cacheVersion || "확인 불가");
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
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      var isUpdate = hadController;
      hadController = true;
      showCacheVersion(function (cacheVersion) {
        pendingVersion = cacheVersion;
        if (isUpdate) applyUpdate(cacheVersion);
      });
    });
    navigator.serviceWorker.register(options.workerUrl, { updateViaCache: "none" }).then(function (registration) {
      function checkUpdate() {
        if (document.visibilityState !== "visible") return;
        registration.update().catch(function (error) { console.warn("업데이트 확인 실패:", error); });
      }
      checkUpdate();
      options.clock.setInterval(checkUpdate, CHECK_MS);
      document.addEventListener("visibilitychange", checkUpdate);
      // A board that was offline may have missed a release.
      if (options.window) options.window.addEventListener("online", checkUpdate);
    }).catch(function (error) { console.warn("Service Worker 등록 실패:", error); });
  }
  return {
    start: start,
    reload: function () { options.location.reload(); },
    // Call when the settings panel closes: a waiting update applies now.
    settingsClosed: function () {
      if (!reloadPending) return;
      reloadPending = false;
      if (mayAutoReload(pendingVersion)) options.location.reload();
    },
  };
}
