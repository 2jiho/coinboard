// Keeps the screen awake. One request in flight; a system release is retried
// once automatically, after that only on a tap, an explicit retry or a new
// visible session. Every state change is reported through onChange.
// kind: active | pending | waiting | unsupported | released | failed
import { m } from "../paraglide/messages.js";
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
      show("unsupported", m.wake_unsupported(), false);
      return Promise.resolve();
    }
    if (suspended || document.visibilityState !== "visible") return Promise.resolve();
    if (pending) return pending;
    if (sentinel && !sentinel.released) return Promise.resolve();
    const requestEpoch = epoch;
    show("pending", m.wake_pending(), false);
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
            show("waiting", m.wake_waiting(), false);
          } else if (automatic && now() - acquiredAt < QUICK_LOSS_MS) {
            show("released", m.wake_released_system(), true);
          } else {
            acquire(true);
          }
        }, { once: true });
        if (lock.released) {
          sentinel = null;
          show("released", m.wake_released(), true);
        } else {
          show("active", m.wake_active(), false);
        }
      } catch (error) {
        console.warn("Wake Lock request failed:", error);
        if (requestEpoch === epoch && !suspended) {
          show("failed", m.wake_failed({ name: error.name }), true);
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
    show("waiting", m.wake_waiting(), false);
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
