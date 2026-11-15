import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, MAX_ASSETS } from '../../src/lib/settings.js';
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); } };
}
const one = (ticker, currency) => ({ assets: [{ currency, ticker }] });
const defaults = { ...one('BTC', 'KRW'), columns: 0, brightness: 100, burnIn: true, palette: 'green-red' };
test('defaults when storage is empty, missing or throws', () => {
  assert.deepEqual(createSettings(memory()).get(), defaults);
  assert.deepEqual(createSettings(null).get(), defaults);
  assert.deepEqual(createSettings({ getItem() { throw new Error('denied'); }, setItem() {}, removeItem() {} }).get(), defaults);
  assert.deepEqual(createSettings(memory({ 'coinboard-settings': '{broken' })).get(), defaults);
});
test('settings saved before the grid (one coin) are read as one asset; invalid fields are ignored', () => {
  const store = memory({ 'coinboard-settings': JSON.stringify({ ticker: 'eth', currency: 'EUR', brightness: 5 }) });
  assert.deepEqual(createSettings(store).get(), { ...one('ETH', 'KRW'), columns: 0, brightness: 100, burnIn: true, palette: 'green-red' });
  const full = memory({ 'coinboard-settings': JSON.stringify({ ticker: 'XRP', currency: 'USDT', brightness: 55 }) });
  assert.deepEqual(createSettings(full).get(), { ...one('XRP', 'USDT'), columns: 0, brightness: 55, burnIn: true, palette: 'green-red' });
});
test('update persists the merged settings', () => {
  const store = memory(); const settings = createSettings(store);
  assert.deepEqual(settings.update({ assets: [{ currency: 'USDT', ticker: 'BTC' }], brightness: 40 }), { saved: true });
  assert.deepEqual(JSON.parse(store.getItem('coinboard-settings')), { ...one('BTC', 'USDT'), columns: 0, brightness: 40, burnIn: true, palette: 'green-red' });
  assert.deepEqual(createSettings(store).get(), { ...one('BTC', 'USDT'), columns: 0, brightness: 40, burnIn: true, palette: 'green-red' });
});
test('a failed write still applies for this run', () => {
  const settings = createSettings({ getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} });
  assert.deepEqual(settings.update({ assets: [{ currency: 'KRW', ticker: 'ETH' }] }), { saved: false });
  assert.equal(settings.get().assets[0].ticker, 'ETH');
  assert.deepEqual(createSettings(null).update({ brightness: 50 }), { saved: false });
});
test('get returns a copy callers cannot corrupt', () => {
  const settings = createSettings(memory()); settings.get().assets[0].ticker = 'ZZZ'; settings.get().assets.push({ currency: 'KRW', ticker: 'ETH' });
  assert.deepEqual(settings.get().assets, [{ currency: 'KRW', ticker: 'BTC' }]);
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
    assert.equal(createSettings(memory({ 'coinboard-settings': JSON.stringify({ currency: market }) })).get().assets[0].currency, market);
  }
  for (const odd of ['USD', 'PERP', '', null, 3]) {
    assert.equal(createSettings(memory({ 'coinboard-settings': JSON.stringify({ currency: odd }) })).get().assets[0].currency, 'KRW', String(odd));
  }
});
test('a list of assets: kept in order, repaired, never empty, never repeated, capped', () => {
  const read = assets => createSettings(memory({ 'coinboard-settings': JSON.stringify({ assets }) })).get().assets;
  assert.deepEqual(read([{ currency: 'USDT-PERP', ticker: 'sol' }, { currency: 'KRW', ticker: 'BTC' }]),
    [{ currency: 'USDT-PERP', ticker: 'SOL' }, { currency: 'KRW', ticker: 'BTC' }]);
  // The same coin in two markets is two assets; the same coin twice in one is one.
  assert.deepEqual(read([{ currency: 'KRW', ticker: 'BTC' }, { currency: 'USDT', ticker: 'BTC' }, { currency: 'KRW', ticker: 'btc' }]),
    [{ currency: 'KRW', ticker: 'BTC' }, { currency: 'USDT', ticker: 'BTC' }]);
  assert.equal(read(Array.from({ length: MAX_ASSETS + 3 }, (_, n) => ({ currency: 'KRW', ticker: `C${n}` }))).length, MAX_ASSETS);
  for (const odd of [[], null, 'BTC', [null, 3]]) assert.deepEqual(read(odd), [{ currency: 'KRW', ticker: 'BTC' }], JSON.stringify(odd));
  const store = memory(); const settings = createSettings(store);
  settings.update({ assets: [{ currency: 'KRW', ticker: 'BTC' }, { currency: 'USDT', ticker: 'ETH' }] });
  assert.deepEqual(createSettings(store).get().assets, [{ currency: 'KRW', ticker: 'BTC' }, { currency: 'USDT', ticker: 'ETH' }]);
  assert.equal('ticker' in JSON.parse(store.getItem('coinboard-settings')), false);
});
test('cells per row: 0 lets the board choose; 1 to 6 by hand; anything else is 0', () => {
  const read = columns => createSettings(memory({ 'coinboard-settings': JSON.stringify({ columns }) })).get().columns;
  for (const columns of [0, 1, 3, 6]) assert.equal(read(columns), columns);
  for (const odd of [7, -1, 2.5, '3', null]) assert.equal(read(odd), 0, String(odd));
  const store = memory(); createSettings(store).update({ columns: 2 });
  assert.equal(createSettings(store).get().columns, 2);
});
