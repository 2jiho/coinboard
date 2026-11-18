// Pull down to refresh, for a board that never scrolls (so the browser's own
// pull to refresh never starts, and a home-screen app has none at all). One
// finger drawn down the board, mostly straight down, pulls a small indicator
// after it; let go past the threshold and the page reloads. A second finger,
// a sideways drag or a pull that started on the controls lets it go.
// Knows nothing of the DOM beyond the events it is given.

// How far the finger must travel, and how far the indicator follows it (it
// moves half as far as the finger, and no further than this).
export const PULL_THRESHOLD = 120;
export const PULL_MAX = 90;

export function createPull({ target, ignore = null, onChange, onRefresh }) {
  let start = null, distance = 0, refreshing = false;
  const touches = new Set();
  const report = () => onChange({ distance: Math.min(PULL_MAX, distance / 2), progress: Math.min(1, distance / PULL_THRESHOLD), ready: distance >= PULL_THRESHOLD, refreshing });
  function cancel() {
    if (start === null && distance === 0) return;
    start = null; distance = 0; report();
  }
  function down(event) {
    if (event.pointerType !== 'touch' || refreshing) return;
    touches.add(event.pointerId);
    // A second finger: a pinch, not a pull.
    if (touches.size > 1) { cancel(); return; }
    if (ignore && event.target?.closest?.(ignore)) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function move(event) {
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y, dx = Math.abs(event.clientX - start.x);
    // Up, or more sideways than down: not a pull.
    if (dy <= 0 || dx > dy) { if (distance) { distance = 0; report(); } return; }
    distance = dy; report();
  }
  function up(event) {
    touches.delete(event.pointerId);
    if (!start || event.pointerId !== start.id) return;
    const ready = distance >= PULL_THRESHOLD;
    start = null;
    if (!ready) { distance = 0; report(); return; }
    refreshing = true; distance = 0; report();
    onRefresh();
  }
  function lost(event) { touches.delete(event.pointerId); if (start && event.pointerId === start.id) cancel(); }
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', lost]];
  for (const [name, handler] of listeners) target.addEventListener(name, handler);
  return { dispose() { for (const [name, handler] of listeners) target.removeEventListener(name, handler); } };
}
