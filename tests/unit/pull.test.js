import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPull, PULL_THRESHOLD } from '../../src/lib/pull.js';

function fixture(ignored = false) {
  const handlers = {}, states = []; let refreshed = 0;
  const target = { addEventListener(name, handler) { handlers[name] = handler; }, removeEventListener(name) { delete handlers[name]; } };
  const pull = createPull({ target, ignore: '#controls', onChange: state => states.push(state), onRefresh: () => { refreshed += 1; } });
  const fire = (name, id, x, y, type = 'touch') => handlers[name]({ pointerId: id, pointerType: type, clientX: x, clientY: y, target: { closest: () => ignored } });
  return { fire, states, get refreshed() { return refreshed; }, pull, handlers };
}

test('a finger drawn far enough down the board refreshes on release', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 100, 50);
  f.fire('pointermove', 1, 105, 50 + PULL_THRESHOLD / 2);
  assert.equal(f.states.at(-1).ready, false);
  assert.ok(f.states.at(-1).progress > 0.4 && f.states.at(-1).progress < 0.6);
  f.fire('pointermove', 1, 110, 50 + PULL_THRESHOLD + 10);
  assert.equal(f.states.at(-1).ready, true);
  assert.equal(f.refreshed, 0, 'nothing until the finger lets go');
  f.fire('pointerup', 1, 110, 50 + PULL_THRESHOLD + 10);
  assert.equal(f.refreshed, 1);
  assert.equal(f.states.at(-1).refreshing, true);
  // While refreshing, another pull does nothing.
  f.fire('pointerdown', 2, 100, 50); f.fire('pointermove', 2, 100, 400); f.fire('pointerup', 2, 100, 400);
  assert.equal(f.refreshed, 1);
});

test('a short pull, a pull back up, or a sideways drag lets go without refreshing', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 100, 50); f.fire('pointermove', 1, 100, 100); f.fire('pointerup', 1, 100, 100);
  assert.equal(f.refreshed, 0); assert.equal(f.states.at(-1).distance, 0);
  f.fire('pointerdown', 1, 100, 50); f.fire('pointermove', 1, 100, 300); f.fire('pointermove', 1, 100, 60); f.fire('pointerup', 1, 100, 60);
  assert.equal(f.refreshed, 0, 'pulled back up before letting go');
  f.fire('pointerdown', 1, 100, 50); f.fire('pointermove', 1, 400, 250); f.fire('pointerup', 1, 400, 250);
  assert.equal(f.refreshed, 0, 'more sideways than down');
});

test('a second finger, a cancelled touch, a mouse or a pull on the controls is not a pull', () => {
  const f = fixture();
  f.fire('pointerdown', 1, 100, 50); f.fire('pointermove', 1, 100, 300);
  f.fire('pointerdown', 2, 200, 50);
  assert.equal(f.states.at(-1).distance, 0, 'a pinch lets the pull go');
  f.fire('pointermove', 1, 100, 400); f.fire('pointerup', 1, 100, 400); f.fire('pointerup', 2, 200, 50);
  assert.equal(f.refreshed, 0);
  f.fire('pointerdown', 3, 100, 50); f.fire('pointermove', 3, 100, 300); f.fire('pointercancel', 3, 100, 300); f.fire('pointerup', 3, 100, 300);
  assert.equal(f.refreshed, 0, 'the browser took the touch');
  f.fire('pointerdown', 4, 100, 50, 'mouse'); f.fire('pointermove', 4, 100, 300, 'mouse'); f.fire('pointerup', 4, 100, 300, 'mouse');
  assert.equal(f.refreshed, 0, 'a mouse drag');
  const g = fixture(true);
  g.fire('pointerdown', 1, 100, 50); g.fire('pointermove', 1, 100, 300); g.fire('pointerup', 1, 100, 300);
  assert.equal(g.refreshed, 0, 'started on the controls');
  f.pull.dispose(); assert.deepEqual(Object.keys(f.handlers), []);
});
