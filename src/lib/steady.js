// One beat for the whole board: prices may arrive many times a second and at
// a different moment for each coin, but the screen changes at most once every
// few seconds, and when it does, every coin with a newer price changes at the
// same moment. The latest price held for each coin is what is shown. Nothing
// is invented and nothing is delayed for longer than the interval.
//
// A coin's first price is shown at once: an empty place does not wait for the
// beat. After a quiet spell (no beat for a whole interval) a price is shown at
// once too, and the beat starts again from there.
export function createBeat(options) {
  const intervalMs = options.intervalMs, onValues = options.onValues;
  const now = options.now || Date.now;
  const timers = options.timers || { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  // Keys shown at least once; values waiting for the beat; when the screen last changed.
  const shown = new Set();
  let held = new Map(), lastBeat = -Infinity, timer = null, dueAt = 0;

  function show(batch) { lastBeat = now(); onValues(batch); }
  function cancel() { if (timer !== null) timers.clearTimeout(timer); timer = null; }
  function beat() {
    cancel();
    if (!held.size) return;
    const batch = held; held = new Map();
    show(batch);
  }
  return {
    // key names the place on the board (one coin in one market).
    push(key, value) {
      if (!shown.has(key)) { shown.add(key); held.delete(key); show(new Map([[key, value]])); return; }
      held.set(key, value);
      if (timer !== null) {
        // The beat is due but its timer has not fired (a hidden tab's timers
        // can be slowed to one a minute): beat now.
        if (now() >= dueAt) beat();
        return;
      }
      const wait = lastBeat + intervalMs - now();
      if (wait <= 0) { beat(); return; }
      dueAt = now() + wait;
      timer = timers.setTimeout(beat, wait);
    },
    // A coin no longer on the board: drop what was held for it; if it comes
    // back, its first price is shown at once again.
    forget(key) { shown.delete(key); held.delete(key); if (!held.size) cancel(); },
    reset() { cancel(); held = new Map(); shown.clear(); lastBeat = -Infinity; },
  };
}
