import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../../src/lib/settings.js';
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); } };
}
const defaults = { ticker: 'BTC', currency: 'KRW', brightness: 100, burnIn: true, palette: 'green-red' };
test('defaults when storage is empty, missing or throws', () => {
  assert.deepEqual(createSettings(memory()).get(), defaults);
  assert.deepEqual(createSettings(null).get(), defaults);
  assert.deepEqual(createSettings({ getItem() { throw new Error('denied'); }, setItem() {}, removeItem() {} }).get(), defaults);
  assert.deepEqual(createSettings(memory({ 'coinboard-settings': '{broken' })).get(), defaults);
});
test('loads valid fields, ignores invalid ones', () => {
  const store = memory({ 'coinboard-settings': JSON.stringify({ ticker: 'eth', currency: 'EUR', brightness: 5 }) });
  assert.deepEqual(createSettings(store).get(), { ticker: 'ETH', currency: 'KRW', brightness: 100, burnIn: true, palette: 'green-red' });
  const full = memory({ 'coinboard-settings': JSON.stringify({ ticker: 'XRP', currency: 'USDT', brightness: 55 }) });
  assert.deepEqual(createSettings(full).get(), { ticker: 'XRP', currency: 'USDT', brightness: 55, burnIn: true, palette: 'green-red' });
});
test('update persists the merged settings', () => {
  const store = memory(); const settings = createSettings(store);
  assert.deepEqual(settings.update({ currency: 'USDT', brightness: 40 }), { saved: true });
  assert.deepEqual(JSON.parse(store.getItem('coinboard-settings')), { ticker: 'BTC', currency: 'USDT', brightness: 40, burnIn: true, palette: 'green-red' });
  assert.deepEqual(createSettings(store).get(), { ticker: 'BTC', currency: 'USDT', brightness: 40, burnIn: true, palette: 'green-red' });
});
test('a failed write still applies for this run', () => {
  const settings = createSettings({ getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} });
  assert.deepEqual(settings.update({ ticker: 'ETH' }), { saved: false });
  assert.equal(settings.get().ticker, 'ETH');
  assert.deepEqual(createSettings(null).update({ ticker: 'ETH' }), { saved: false });
});
test('get returns a copy callers cannot corrupt', () => {
  const settings = createSettings(memory()); settings.get().ticker = 'ZZZ';
  assert.equal(settings.get().ticker, 'BTC');
});
test('normalizeTicker trims and upper-cases valid tickers and rejects the rest', () => {
  const settings = createSettings(memory());
  assert.equal(settings.normalizeTicker(' eth '), 'ETH');
  assert.equal(settings.normalizeTicker('1INCH'), '1INCH');
  for (const bad of ['', '   ', '비트', 'BTC-USD', 'A'.repeat(21), null, undefined]) assert.equal(settings.normalizeTicker(bad), null);
});
test('burn-in protection is on unless it was switched off', () => {
  assert.equal(createSettings(memory()).get().burnIn, true);
  const store = memory(); const settings = createSettings(store);
  assert.deepEqual(settings.update({ burnIn: false }), { saved: true });
  assert.equal(createSettings(store).get().burnIn, false);
  for (const odd of [0, 'false', null]) {
    assert.equal(createSettings(memory({ 'coinboard-settings': JSON.stringify({ burnIn: odd }) })).get().burnIn, true, String(odd));
  }
});
test('the removed debug setting is neither kept nor written back', () => {
  const store = memory({ 'coinboard-settings': JSON.stringify({ ticker: 'ETH', debug: true }) });
  const settings = createSettings(store);
  assert.equal('debug' in settings.get(), false);
  settings.update({ brightness: 80 });
  assert.equal('debug' in JSON.parse(store.getItem('coinboard-settings')), false);
});
test('the up/down colours are green and red unless the red-and-blue pair was chosen', () => {
  assert.equal(createSettings(memory()).get().palette, 'green-red');
  const store = memory(); const settings = createSettings(store);
  assert.deepEqual(settings.update({ palette: 'red-blue' }), { saved: true });
  assert.equal(createSettings(store).get().palette, 'red-blue');
  for (const odd of ['purple', 1, null, '']) {
    assert.equal(createSettings(memory({ 'coinboard-settings': JSON.stringify({ palette: odd }) })).get().palette, 'green-red', String(odd));
  }
});
test('the market can be Upbit, Binance spot or Binance perpetual futures; anything else falls back to Upbit', () => {
  for (const market of ['KRW', 'USDT', 'USDT-PERP']) {
    assert.equal(createSettings(memory({ 'coinboard-settings': JSON.stringify({ currency: market }) })).get().currency, market);
  }
  for (const odd of ['USD', 'PERP', '', null, 3]) {
    assert.equal(createSettings(memory({ 'coinboard-settings': JSON.stringify({ currency: odd }) })).get().currency, 'KRW', String(odd));
  }
});
