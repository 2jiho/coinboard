import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPacer } from '../../src/lib/pace.js';

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)); }, data };
}
test('nothing sent yet: no wait', () => {
  const pacer = createPacer({ now: () => 1000, store: null });
  assert.equal(pacer.waitFor('KRW'), 0); assert.equal(pacer.waitFor('USDT'), 0);
});
test('Upbit is given eleven seconds between requests (ten, with a margin), Binance two; each on its own', () => {
  let time = 50000;
  const pacer = createPacer({ now: () => time, store: null });
  pacer.mark('KRW');
  assert.equal(pacer.waitFor('KRW'), 11000); assert.equal(pacer.waitFor('USDT'), 0);
  time += 4000; assert.equal(pacer.waitFor('KRW'), 7000);
  pacer.mark('USDT'); assert.equal(pacer.waitFor('USDT'), 2000);
  time += 7000; assert.equal(pacer.waitFor('KRW'), 0); assert.equal(pacer.waitFor('USDT'), 0);
});
test('the last request is remembered across a reload, for a minute', () => {
  const store = memory();
  createPacer({ now: () => 100000, store }).mark('KRW');
  assert.equal(createPacer({ now: () => 103000, store }).waitFor('KRW'), 8000);
  assert.equal(createPacer({ now: () => 200000, store }).waitFor('KRW'), 0);
});
test('a stored time from the future, or nonsense, is ignored; a broken store is survived', () => {
  assert.equal(createPacer({ now: () => 1000, store: memory({ 'coinboard-connect-KRW': '999999' }) }).waitFor('KRW'), 0);
  assert.equal(createPacer({ now: () => 1000, store: memory({ 'coinboard-connect-KRW': 'soon' }) }).waitFor('KRW'), 0);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const pacer = createPacer({ now: () => 1000, store: broken });
  pacer.mark('KRW'); assert.equal(pacer.waitFor('KRW'), 11000);
});
