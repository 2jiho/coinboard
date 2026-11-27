// Keeps the screen awake. One request in flight; a system release is retried
// once automatically, after that only on a tap, an explicit retry or a new
// visible session. Every state change is reported through onChange.
// It can be switched off (enabled: false, setEnabled): the lock is let go and
// nothing is asked for until it is switched on again.
// kind: active | pending | waiting | unsupported | released | failed | off
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
  let enabled = options.enabled !== false;
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
    if (!enabled) { show("off", m.wake_off(), false); return Promise.resolve(); }
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
        if (requestEpoch !== epoch || !enabled || suspended || document.visibilityState !== "visible") {
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
        if (requestEpoch === epoch && enabled && !suspended) {
          show("failed", m.wake_failed({ name: error.name }), true);
        }
      } finally {
        pending = null;
      }
    });
    // A hide/show transition during a request invalidates it. Finish disposing
    // of the old lock before making one request for the current visible session.
    pending.then(() => {
      if (requestEpoch !== epoch && enabled && !suspended && document.visibilityState === "visible") acquire(false);
    });
    return pending;
  }

  // Let the lock go: the page is hidden (suspend) or keeping the screen on was switched off.
  function letGo(nextKind, message) {
    epoch++;
    const oldLock = sentinel;
    sentinel = null;
    show(nextKind, message, false);
    release(oldLock);
  }
  function suspend() {
    if (suspended) { show(enabled ? "waiting" : "off", enabled ? m.wake_waiting() : m.wake_off(), false); return; }
    suspended = true;
    if (enabled) letGo("waiting", m.wake_waiting());
    else show("off", m.wake_off(), false);
  }
  function setEnabled(value) {
    value = !!value;
    if (value === enabled) return;
    enabled = value;
    if (!enabled) letGo("off", m.wake_off());
    else if (!suspended) acquire(false);
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
    setEnabled,
    dispose() {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", resume);
      suspend();
    },
  };
}
