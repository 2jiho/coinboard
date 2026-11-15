// Lets the screen change at a calm pace however fast prices arrive: a value
// is shown at once if nothing was shown in the last few seconds; otherwise
// it is held, and when the time is up the latest one held is shown. Nothing is
// invented and nothing is delayed for longer than the interval.
export function createSteady(options) {
  const intervalMs = options.intervalMs, onValue = options.onValue;
  const now = options.now || Date.now;
  const timers = options.timers || { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  let shownAt = -Infinity, held, holding = false, timer = null;

  function show(value) { shownAt = now(); onValue(value); }
  return {
    push(value) {
      const wait = shownAt + intervalMs - now();
      if (wait <= 0 && !holding) { show(value); return; }
      held = value;
      if (holding) return;
      holding = true;
      timer = timers.setTimeout(() => { timer = null; holding = false; show(held); }, Math.max(0, wait));
    },
    // A different coin: forget what was held, and show its first price at once.
    reset() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null; holding = false; held = undefined; shownAt = -Infinity;
    },
  };
}
