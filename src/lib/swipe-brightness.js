// Brightness by swiping: one finger drawn up the board brightens it, drawn
// down dims it, a share of the screen's height (SWIPE_SPAN) being the whole range. Like the
// brightness bar in the system's own control centre. A swipe is told from a
// tap by moving more than a few pixels, and from a sideways drag by moving
// more up or down than across; a second finger, or a swipe that starts on the
// controls, lets it go and puts the brightness back. Knows nothing of the DOM
// beyond the events it is given.

// How much of the screen's height a finger travels for the whole range.
export const SWIPE_SPAN = 0.6;
// How far a finger moves before it counts as a swipe.
export const SWIPE_START = 8;

export function createSwipeBrightness({ target, ignore = null, height, onStart, onChange, onEnd, onCancel }) {
  let start = null, swiping = false;
  const touches = new Set();
  function cancel() {
    const was = swiping;
    start = null; swiping = false;
    if (was) onCancel();
  }
  function down(event) {
    if (event.pointerType !== 'touch') return;
    touches.add(event.pointerId);
    // A second finger: not a swipe.
    if (touches.size > 1) { cancel(); return; }
    if (ignore && event.target?.closest?.(ignore)) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function move(event) {
    if (!start || event.pointerId !== start.id) return;
    const up = start.y - event.clientY, across = Math.abs(event.clientX - start.x);
    if (!swiping) {
      if (Math.abs(up) < SWIPE_START) return;
      // More across than up or down: a sideways drag, not ours.
      if (across > Math.abs(up)) { start = null; return; }
      swiping = true; onStart();
    }
    // A share of the whole range, up positive: +1 is the whole range brighter.
    onChange(up / Math.max(1, height() * SWIPE_SPAN));
  }
  function up(event) {
    touches.delete(event.pointerId);
    if (!start || event.pointerId !== start.id) return;
    const was = swiping;
    start = null; swiping = false;
    if (was) onEnd();
  }
  function lost(event) { touches.delete(event.pointerId); if (start && event.pointerId === start.id) cancel(); }
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', lost]];
  for (const [name, handler] of listeners) target.addEventListener(name, handler);
  return { dispose() { for (const [name, handler] of listeners) target.removeEventListener(name, handler); } };
}
