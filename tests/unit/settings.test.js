import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../../src/lib/settings.js';
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); } };
}
const defaults = { ticker: 'BTC', currency: 'KRW', brightness: 100, burnIn: true };
test('defaults when storage is empty, missing or throws', () => {
  assert.deepEqual(createSettings(memory()).get(), defaults);
  assert.deepEqual(createSettings(null).get(), defaults);
  assert.deepEqual(createSettings({ getItem() { throw new Error('denied'); }, setItem() {}, removeItem() {} }).get(), defaults);
  assert.deepEqual(createSettings(memory({ 'coinboard-settings': '{broken' })).get(), defaults);
});
test('loads valid fields, ignores invalid ones, removes obsolete rate key', () => {
  const store = memory({ 'coinboard-settings': JSON.stringify({ ticker: 'eth', currency: 'EUR', brightness: 5 }), 'btc-last-exchange-rate': '1' });
  assert.deepEqual(createSettings(store).get(), { ticker: 'ETH', currency: 'KRW', brightness: 100, burnIn: true });
  assert.equal(store.getItem('btc-last-exchange-rate'), null);
  const full = memory({ 'coinboard-settings': JSON.stringify({ ticker: 'XRP', currency: 'USDT', brightness: 55 }) });
  assert.deepEqual(createSettings(full).get(), { ticker: 'XRP', currency: 'USDT', brightness: 55, burnIn: true });
});
test('update persists the merged settings', () => {
  const store = memory(); const settings = createSettings(store);
  assert.deepEqual(settings.update({ currency: 'USDT', brightness: 40 }), { saved: true });
  assert.deepEqual(JSON.parse(store.getItem('coinboard-settings')), { ticker: 'BTC', currency: 'USDT', brightness: 40, burnIn: true });
  assert.deepEqual(createSettings(store).get(), { ticker: 'BTC', currency: 'USDT', brightness: 40, burnIn: true });
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
test('settings saved under the old btc-kiosk name are carried over once', () => {
  const store = memory({ 'btc-kiosk-settings': JSON.stringify({ ticker: 'ETH', currency: 'USDT', brightness: 60 }) });
  const settings = createSettings(store);
  assert.deepEqual(settings.get(), { ticker: 'ETH', currency: 'USDT', brightness: 60, burnIn: true });
  settings.update({ brightness: 70 });
  assert.equal(JSON.parse(store.getItem('coinboard-settings')).brightness, 70);
  assert.equal(store.getItem('btc-kiosk-settings'), null);
  const both = memory({ 'btc-kiosk-settings': JSON.stringify({ ticker: 'ETH' }), 'coinboard-settings': JSON.stringify({ ticker: 'XRP' }) });
  assert.equal(createSettings(both).get().ticker, 'XRP');
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
