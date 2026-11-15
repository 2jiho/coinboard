import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBeat } from '../../src/lib/steady.js';

function fixture(intervalMs = 3000) {
  const batches = [], timers = new Map(); let time = 0, id = 0;
  const beat = createBeat({ intervalMs, now: () => time, onValues: batch => batches.push({ at: time, values: Object.fromEntries(batch) }),
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
  const shown = key => batches.filter(batch => key in batch.values).map(batch => batch.values[key]);
  return { beat, batches, shown, advance, pending: () => timers.size };
}
test('a coin\'s first price is shown at once', () => {
  const f = fixture(); f.beat.push('BTC', 'a');
  assert.deepEqual(f.shown('BTC'), ['a']);
});
test('prices arriving within three seconds are held, and only the latest is shown on the beat', () => {
  const f = fixture(); f.beat.push('BTC', 'a');
  f.advance(500); f.beat.push('BTC', 'b'); f.advance(500); f.beat.push('BTC', 'c'); f.advance(1000); f.beat.push('BTC', 'd');
  assert.deepEqual(f.shown('BTC'), ['a']);
  f.advance(999); assert.deepEqual(f.shown('BTC'), ['a']);
  f.advance(1); assert.deepEqual(f.shown('BTC'), ['a', 'd']);
});
test('every coin with a newer price changes on the same beat, together', () => {
  const f = fixture();
  f.beat.push('BTC', 1); f.beat.push('ETH', 1); f.beat.push('XRP', 1);
  f.advance(400); f.beat.push('BTC', 2);
  f.advance(1700); f.beat.push('ETH', 2);
  f.advance(800); f.beat.push('BTC', 3);
  f.advance(100);
  const last = f.batches.at(-1);
  assert.deepEqual(last, { at: 3000, values: { BTC: 3, ETH: 2 } }, 'one change for both, three seconds on; XRP had nothing new');
  f.advance(2000); f.beat.push('XRP', 2); f.advance(500); f.beat.push('ETH', 3);
  f.advance(500);
  assert.deepEqual(f.batches.at(-1), { at: 6000, values: { XRP: 2, ETH: 3 } });
});
test('however fast prices arrive, the screen changes at most once every three seconds', () => {
  const f = fixture();
  for (let ms = 0; ms <= 30000; ms += 100) { f.beat.push('BTC', ms); f.beat.push('ETH', ms + 1); f.advance(100); }
  const times = f.batches.map(batch => batch.at);
  for (let i = 2; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 3000, 'beats are three seconds apart');
  assert.ok(times.length >= 10 && times.length <= 12);
});
test('after a quiet spell the next price is shown at once again', () => {
  const f = fixture(); f.beat.push('BTC', 'a'); f.advance(10000); f.beat.push('BTC', 'b');
  assert.deepEqual(f.shown('BTC'), ['a', 'b']);
  assert.equal(f.pending(), 0);
});
test('a coin taken off the board is forgotten: nothing held is shown, and its next first price is shown at once', () => {
  const f = fixture(); f.beat.push('BTC', 'a'); f.beat.push('ETH', 'a');
  f.advance(1000); f.beat.push('ETH', 'old');
  f.beat.forget('ETH'); assert.equal(f.pending(), 0);
  f.advance(5000); assert.deepEqual(f.shown('ETH'), ['a']);
  f.beat.push('ETH', 'back'); assert.deepEqual(f.shown('ETH'), ['a', 'back']);
});
test('reset drops everything held', () => {
  const f = fixture(); f.beat.push('BTC', 'a'); f.advance(1000); f.beat.push('BTC', 'b');
  f.beat.reset(); assert.equal(f.pending(), 0);
  f.advance(10000); assert.deepEqual(f.shown('BTC'), ['a']);
});
test('a late timer does not hold prices back: once the beat is due, the next arrival brings it', () => {
  // A hidden tab's timers may be slowed to one a minute, but prices keep arriving.
  let time = 0; const batches = [];
  const slow = createBeat({ intervalMs: 3000, now: () => time, onValues: batch => batches.push(Object.fromEntries(batch)), timers: { setTimeout: () => 1, clearTimeout() {} } });
  slow.push('BTC', 'x'); slow.push('ETH', 'x');
  time = 1000; slow.push('BTC', 'y'); assert.equal(batches.length, 2);
  time = 3500; slow.push('ETH', 'z');
  assert.deepEqual(batches.at(-1), { BTC: 'y', ETH: 'z' }, 'shown on arrival, the stalled timer notwithstanding');
  time = 4000; slow.push('BTC', 'w'); assert.equal(batches.length, 3, 'and the pace still holds afterwards');
});
