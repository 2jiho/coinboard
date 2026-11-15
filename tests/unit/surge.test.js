import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurgeDetector } from '../../src/lib/surge.js';

test('a move of half a percent within a minute is a surge, in its direction', () => {
  const up = createSurgeDetector();
  assert.equal(up.push(100, 0), 0);
  assert.equal(up.push(100.4, 20000), 0);
  assert.equal(up.push(100.5, 40000), 1);
  const down = createSurgeDetector();
  down.push(100, 0);
  assert.equal(down.push(99.5, 59000), -1);
});
test('the same move spread over more than a minute is not a surge', () => {
  const d = createSurgeDetector();
  d.push(100, 0); d.push(100.2, 40000); d.push(100.35, 80000);
  assert.equal(d.push(100.5, 120000), 0);
});
test('after a surge the detector is quiet for a minute, then measures afresh from there', () => {
  const d = createSurgeDetector();
  d.push(100, 0);
  assert.equal(d.push(101, 1000), 1);
  assert.equal(d.push(102, 2000), 0, 'still quiet');
  assert.equal(d.push(103, 30000), 0, 'still quiet');
  assert.equal(d.push(103.1, 62000), 0, 'measured from the surge onwards, within the last minute only');
  assert.equal(d.push(103.7, 70000), 1);
});
test('reset forgets the old coin, so switching coins is never a surge', () => {
  const d = createSurgeDetector();
  d.push(98000000, 0); d.reset();
  assert.equal(d.push(70000, 1000), 0);
});
test('nonsense prices are ignored', () => {
  const d = createSurgeDetector();
  d.push(100, 0);
  for (const bad of [0, -1, NaN, Infinity, undefined]) assert.equal(d.push(bad, 1000), 0);
  assert.equal(d.push(100.6, 2000), 1);
});
test('it does not hoard old prices', () => {
  const d = createSurgeDetector();
  for (let second = 0; second < 3600; second++) d.push(100, second * 1000);
  assert.ok(d.size() <= 61);
});
