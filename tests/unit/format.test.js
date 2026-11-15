import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price, priceParts, change, direction, tabTitle } from '../../src/lib/format.js';
test('large won prices are written the Korean way, in 억 and 만', () => {
  assert.equal(price('KRW', 123400000), '1억 2340만 KRW');
  assert.equal(price('KRW', 123456789), '1억 2346만 KRW');
  assert.equal(price('KRW', 98000000), '9800만 KRW');
  assert.equal(price('KRW', 89337000), '8934만 KRW');
  assert.equal(price('KRW', 100000000), '1억 KRW');
  assert.equal(price('KRW', 100340000), '1억 34만 KRW');
  assert.equal(price('KRW', 2500000000), '25억 KRW');
});
test('rounding to 만 never shows 10000만: it carries into 억', () => {
  assert.equal(price('KRW', 99996000), '1억 KRW');
  assert.equal(price('KRW', 199999999), '2억 KRW');
});
test('won from 100만 to 1000만 is written in 만 with one decimal', () => {
  assert.equal(price('KRW', 4512000), '451.2만 KRW');
  assert.equal(price('KRW', 4500000), '450.0만 KRW');
  assert.equal(price('KRW', 1000000), '100.0만 KRW');
  assert.equal(price('KRW', 9999400), '999.9만 KRW');
});
test('rounding up out of a range moves to the next range\'s way of writing', () => {
  assert.equal(price('KRW', 9999600), '1000만 KRW');
  assert.equal(price('USDT', 999.96), '1,000 USDT');
  assert.equal(price('USDT', 9.9996), '10.00 USDT');
});
test('won from 100 to 100만 is written out in full', () => {
  assert.equal(price('KRW', 152300), '152,300 KRW');
  assert.equal(price('KRW', 3245), '3,245 KRW');
  assert.equal(price('KRW', 215), '215 KRW');
  assert.equal(price('KRW', 100), '100 KRW');
});
test('USDT always shows at least four figures and no more decimals than that needs', () => {
  assert.equal(price('USDT', 70123.4), '70,123 USDT');
  assert.equal(price('USDT', 3456.78), '3,457 USDT');
  assert.equal(price('USDT', 1000), '1,000 USDT');
  assert.equal(price('USDT', 152.34), '152.3 USDT');
  assert.equal(price('USDT', 100), '100.0 USDT');
  assert.equal(price('USDT', 98.765), '98.77 USDT');
  assert.equal(price('USDT', 12.3), '12.30 USDT');
  assert.equal(price('USDT', 2.3456), '2.346 USDT');
  assert.equal(price('USDT', 1), '1.000 USDT');
});
test('prices under 100 KRW or 1 USDT show exactly four significant digits', () => {
  assert.equal(price('KRW', 12.6), '12.60 KRW');
  assert.equal(price('KRW', 0.0123), '0.01230 KRW');
  assert.equal(price('USDT', 0.6234), '0.6234 USDT');
  assert.equal(price('USDT', 0.5), '0.5000 USDT');
  assert.equal(price('USDT', 0.00001234), '0.00001234 USDT');
});
test('priceParts gives the pieces to draw: numbers, their 억/만 marks, and the currency code', () => {
  assert.deepEqual(priceParts('KRW', 123400000), { pieces: [{ number: '1', mark: '억' }, { number: '2340', mark: '만' }], unit: 'KRW' });
  assert.deepEqual(priceParts('KRW', 98000000), { pieces: [{ number: '9800', mark: '만' }], unit: 'KRW' });
  assert.deepEqual(priceParts('KRW', 4512000), { pieces: [{ number: '451.2', mark: '만' }], unit: 'KRW' });
  assert.deepEqual(priceParts('KRW', 152300), { pieces: [{ number: '152,300', mark: '' }], unit: 'KRW' });
  assert.deepEqual(priceParts('USDT', 70000.1), { pieces: [{ number: '70,000', mark: '' }], unit: 'USDT' });
  for (const [currency, value] of [['KRW', 123400000], ['KRW', 98000000], ['KRW', 0.0123], ['USDT', 65000], ['USDT', 0.00001234]]) {
    const parts = priceParts(currency, value);
    assert.equal(parts.pieces.map(piece => piece.number + piece.mark).join(' ') + ' ' + parts.unit, price(currency, value));
  }
});
test('change shows its direction as an arrow, readable without colour', () => {
  assert.equal(change(1.234), '▲ 1.23%');
  assert.equal(change(-0.5), '▼ 0.50%');
  assert.equal(change(-12.345), '▼ 12.35%');
});
test('a change that rounds to zero carries no arrow and no direction', () => {
  for (const tiny of [-0.004, 0, 0.004]) { assert.equal(change(tiny), '0.00%'); assert.equal(direction(tiny), 0); }
  assert.equal(direction(0.005), 1); assert.equal(direction(-0.02), -1);
});
test('the tab title is the price and the ticker, nothing more', () => {
  assert.equal(tabTitle('BTC', 'KRW', { price: 89960000, change: 1.234 }), '8996만 | BTC');
  assert.equal(tabTitle('BTC', 'KRW', { price: 123400000, change: 0 }), '1억 2340만 | BTC');
  assert.equal(tabTitle('ETH', 'USDT', { price: 3457.82, change: -0.96 }), '3,458 | ETH');
});
test('with no price yet the tab title is the ticker and the app name', () => {
  assert.equal(tabTitle('BTC', 'KRW', null), 'BTC | Coinboard');
});
