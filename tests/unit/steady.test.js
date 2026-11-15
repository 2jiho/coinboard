import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSteady } from '../../src/lib/steady.js';

function fixture(intervalMs = 3000) {
  const shown = [], timers = new Map(); let time = 0, id = 0;
  const steady = createSteady({ intervalMs, now: () => time, onValue: value => shown.push(value),
    timers: { setTimeout: (cb, ms) => { timers.set(++id, { cb, at: time + ms }); return id; }, clearTimeout: key => { timers.delete(key); } } });
  function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].cb();
    }
    time = end;
  }
  return { steady, shown, advance, pending: () => timers.size };
}
test('the first value is shown at once', () => {
  const f = fixture(); f.steady.push('a');
  assert.deepEqual(f.shown, ['a']);
});
test('values arriving within three seconds are held, and only the latest is shown when the three seconds are up', () => {
  const f = fixture(); f.steady.push('a');
  f.advance(500); f.steady.push('b'); f.advance(500); f.steady.push('c'); f.advance(1000); f.steady.push('d');
  assert.deepEqual(f.shown, ['a']);
  f.advance(999); assert.deepEqual(f.shown, ['a']);
  f.advance(1); assert.deepEqual(f.shown, ['a', 'd']);
});
test('however fast values arrive, the screen changes at most once every three seconds', () => {
  const f = fixture(); const times = [];
  for (let ms = 0; ms <= 30000; ms += 100) { const before = f.shown.length; f.steady.push(ms); if (f.shown.length > before) times.push(ms); f.advance(100); }
  assert.ok(f.shown.length >= 10 && f.shown.length <= 11);
  for (let i = 1; i < f.shown.length; i++) assert.ok(f.shown[i] - f.shown[i - 1] >= 2900, 'shown values are about three seconds apart');
});
test('after a quiet spell the next value is shown at once again', () => {
  const f = fixture(); f.steady.push('a'); f.advance(10000); f.steady.push('b');
  assert.deepEqual(f.shown, ['a', 'b']);
  assert.equal(f.pending(), 0);
});
test('reset drops what was held and starts over: the next value is shown at once', () => {
  const f = fixture(); f.steady.push('a'); f.advance(1000); f.steady.push('old coin');
  f.steady.reset(); assert.equal(f.pending(), 0);
  f.steady.push('new coin'); assert.deepEqual(f.shown, ['a', 'new coin']);
  f.advance(10000); assert.deepEqual(f.shown, ['a', 'new coin']);
});
test('a late timer does not hold a value back: once the three seconds are up, the next arrival shows at once', () => {
  // A hidden tab's timers may be slowed to one a minute, but prices keep arriving.
  const f = fixture(); f.steady.push('a');
  f.advance(1000); f.steady.push('b');
  // Time passes without the timer having fired (simulated by pushing "later" on the same clock).
  let late = 0; const slow = createSteady({ intervalMs: 3000, now: () => late, onValue: v => f.shown.push('slow:' + v), timers: { setTimeout: () => 1, clearTimeout() {} } });
  slow.push('x'); late = 1000; slow.push('y'); assert.deepEqual(f.shown.slice(-1), ['slow:x']);
  late = 3500; slow.push('z');
  assert.deepEqual(f.shown.slice(-1), ['slow:z'], 'shown on arrival, the stalled timer notwithstanding');
  late = 4000; slow.push('w'); assert.deepEqual(f.shown.slice(-1), ['slow:z'], 'and the pace still holds afterwards');
});
