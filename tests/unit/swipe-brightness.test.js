import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwipeBrightness, SWIPE_SPAN } from '../../src/lib/swipe-brightness.js';

function fixture(ignored = false) {
  const handlers = {}, log = [];
  const target = { addEventListener(name, handler) { handlers[name] = handler; }, removeEventListener(name) { delete handlers[name]; } };
  const swipe = createSwipeBrightness({ target, ignore: '#controls', height: () => 800 / SWIPE_SPAN,
    onStart: () => log.push('start'), onChange: share => log.push(Math.round(share * 100) / 100), onEnd: () => log.push('end'), onCancel: () => log.push('cancel') });
  const fire = (name, id, x, y, type = 'touch') => handlers[name]({ pointerId: id, pointerType: type, clientX: x, clientY: y, target: { closest: () => ignored } });
  return { fire, log, swipe, handlers };
}

test('a finger drawn up brightens and down dims, by its share of the screen height', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 500, 600);
  f.fire('pointermove', 1, 502, 595);
  assert.deepEqual(f.log, [], 'a few pixels are still a tap');
  f.fire('pointermove', 1, 505, 400);
  f.fire('pointermove', 1, 505, 200);
  f.fire('pointermove', 1, 505, 800);
  f.fire('pointerup', 1, 505, 800);
  assert.deepEqual(f.log, ['start', 0.25, 0.5, -0.25, 'end']);
});

test('a tap, a sideways drag or a mouse is not a swipe', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 500, 600); f.fire('pointerup', 1, 500, 600);
  f.fire('pointerdown', 1, 500, 600); f.fire('pointermove', 1, 700, 560); f.fire('pointermove', 1, 700, 300); f.fire('pointerup', 1, 700, 300);
  f.fire('pointerdown', 2, 500, 600, 'mouse'); f.fire('pointermove', 2, 500, 200, 'mouse'); f.fire('pointerup', 2, 500, 200, 'mouse');
  assert.deepEqual(f.log, []);
});

test('a second finger, a cancelled touch or a swipe from the controls puts it back', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 500, 600); f.fire('pointermove', 1, 500, 400);
  f.fire('pointerdown', 2, 700, 600);
  f.fire('pointermove', 1, 500, 200); f.fire('pointerup', 1, 500, 200); f.fire('pointerup', 2, 700, 600);
  assert.deepEqual(f.log, ['start', 0.25, 'cancel'], 'a pinch lets it go');
  f.log.length = 0;
  f.fire('pointerdown', 3, 500, 600); f.fire('pointermove', 3, 500, 400); f.fire('pointercancel', 3, 500, 400);
  assert.deepEqual(f.log, ['start', 0.25, 'cancel']);
  const g = fixture(true);
  g.fire('pointerdown', 1, 500, 600); g.fire('pointermove', 1, 500, 200); g.fire('pointerup', 1, 500, 200);
  assert.deepEqual(g.log, [], 'started on the controls');
  f.swipe.dispose(); assert.deepEqual(Object.keys(f.handlers), []);
});
