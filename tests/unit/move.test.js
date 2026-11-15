import test from 'node:test';
import assert from 'node:assert/strict';
import { moveStrength } from '../../src/lib/move.js';

test('a move is slight, ordinary or large by its share of the price', () => {
  assert.equal(moveStrength(100000, 100000), 0);
  assert.equal(moveStrength(100000, 100010), 1); // 0.01 %
  assert.equal(moveStrength(100000, 99990), 1);
  assert.equal(moveStrength(100000, 100020), 2); // 0.02 %
  assert.equal(moveStrength(100000, 99950), 2);
  assert.equal(moveStrength(100000, 100100), 3); // 0.1 %
  assert.equal(moveStrength(100000, 98000), 3);
});
test('the share is of the price, so cheap coins are judged alike', () => {
  assert.equal(moveStrength(0.5, 0.50004), 1);
  assert.equal(moveStrength(0.5, 0.5002), 2);
  assert.equal(moveStrength(0.5, 0.501), 3);
});
test('no strength without a usable previous price', () => {
  for (const previous of [null, undefined, 0, NaN]) assert.equal(moveStrength(previous, 100), 0);
  assert.equal(moveStrength(100, NaN), 0);
});
