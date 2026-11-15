// Keeps the screen awake. One request in flight; a system release is retried
// once automatically, after that only on a tap, an explicit retry or a new
// visible session. Every state change is reported through onChange.
// kind: active | pending | waiting | unsupported | released | failed
export function createWakeLock(options) {
  const navigator = options.navigator, document = options.document, window = options.window;
  const now = options.now || Date.now;
  const onChange = options.onChange || (() => {});
  let sentinel = null;
  let pending = null;
  let epoch = 0;
  let kind = null;
  let suspended = document.visibilityState !== "visible";
  // A lock won by the automatic retry that is lost again this quickly means the
  // system keeps refusing (low power mode): stop instead of looping.
  const QUICK_LOSS_MS = 5000;

  function show(nextKind, message, canRetry) {
    kind = nextKind;
    onChange({ kind: nextKind, message, canRetry });
  }

  function release(lock) {
    if (lock && !lock.released) {
      return lock.release().catch((error) => {
        console.warn("Wake Lock release failed:", error);
      });
    }
    return Promise.resolve();
  }

  function acquire(automatic) {
    if (!window.isSecureContext || !("wakeLock" in navigator)) {
      show("unsupported", "화면 켜짐 유지 미지원 · HTTPS 및 브라우저 지원을 확인하세요", false);
      return Promise.resolve();
    }
    if (suspended || document.visibilityState !== "visible") return Promise.resolve();
    if (pending) return pending;
    if (sentinel && !sentinel.released) return Promise.resolve();
    const requestEpoch = epoch;
    show("pending", "화면 켜짐 유지 요청 중…", false);
    pending = Promise.resolve().then(async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (requestEpoch !== epoch || suspended || document.visibilityState !== "visible") {
          await release(lock);
          return;
        }
        const acquiredAt = now();
        sentinel = lock;
        lock.addEventListener("release", () => {
          if (sentinel !== lock) return;
          sentinel = null;
          if (suspended) {
            show("waiting", "화면 켜짐 유지 대기 · 앱으로 돌아오면 재요청합니다", false);
          } else if (automatic && now() - acquiredAt < QUICK_LOSS_MS) {
            show("released", "화면 켜짐 유지 해제됨 · 시스템 설정을 확인하고 다시 시도하세요", true);
          } else {
            acquire(true);
          }
        }, { once: true });
        if (lock.released) {
          sentinel = null;
          show("released", "화면 켜짐 유지 해제됨 · 다시 시도하세요", true);
        } else {
          show("active", "화면 켜짐 유지 활성 · 시스템에서 해제할 수 있습니다", false);
        }
      } catch (error) {
        console.warn("Wake Lock request failed:", error);
        if (requestEpoch === epoch && !suspended) {
          show("failed", `화면 켜짐 유지 실패 (${error.name}) · 저전력 모드·배터리·권한을 확인하세요`, true);
        }
      } finally {
        pending = null;
      }
    });
    // A hide/show transition during a request invalidates it. Finish disposing
    // of the old lock before making one request for the current visible session.
    pending.then(() => {
      if (requestEpoch !== epoch && !suspended && document.visibilityState === "visible") acquire(false);
    });
    return pending;
  }

  function suspend() {
    if (!suspended) epoch++;
    suspended = true;
    const oldLock = sentinel;
    sentinel = null;
    show("waiting", "화면 켜짐 유지 대기 · 앱으로 돌아오면 재요청합니다", false);
    release(oldLock);
  }

  function resume() {
    if (document.visibilityState !== "visible") return;
    if (!suspended) return;
    suspended = false;
    acquire(false);
  }

  // Any touch on the board is a chance to win the lock back.
  function onPointerDown() { if (kind === "released" || kind === "failed") acquire(false); }
  function onVisibility() { if (document.visibilityState === "visible") resume(); else suspend(); }
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  acquire(false);
  return {
    retry() { return acquire(false); },
    dispose() {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", resume);
      suspend();
    },
  };
}
