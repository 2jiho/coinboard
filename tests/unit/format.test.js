import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price, priceParts, change, direction } from '../../src/lib/format.js';
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
test('won prices under 1000만 keep every digit, so nothing meaningful is rounded away', () => {
  assert.equal(price('KRW', 9999999), '9,999,999 KRW');
  assert.equal(price('KRW', 4512000), '4,512,000 KRW');
  assert.equal(price('KRW', 1234.5), '1,235 KRW');
  assert.equal(price('KRW', 100), '100 KRW');
});
test('USDT shows whole dollars from 100 up, cents below that', () => {
  assert.equal(price('USDT', 70000.1), '70,000 USDT');
  assert.equal(price('USDT', 3456.78), '3,457 USDT');
  assert.equal(price('USDT', 100), '100 USDT');
  assert.equal(price('USDT', 99.994), '99.99 USDT');
  assert.equal(price('USDT', 12.3), '12.30 USDT');
  assert.equal(price('USDT', 1), '1.00 USDT');
});
test('sub-unit prices always show exactly four significant digits', () => {
  assert.equal(price('KRW', 12.6), '12.60 KRW');
  assert.equal(price('KRW', 0.0123), '0.01230 KRW');
  assert.equal(price('USDT', 0.4567), '0.4567 USDT');
  assert.equal(price('USDT', 0.5), '0.5000 USDT');
  assert.equal(price('USDT', 0.00001234), '0.00001234 USDT');
});
test('priceParts gives the pieces to draw: numbers, their 억/만 marks, and the currency code', () => {
  assert.deepEqual(priceParts('KRW', 123400000), { pieces: [{ number: '1', mark: '억' }, { number: '2340', mark: '만' }], unit: 'KRW' });
  assert.deepEqual(priceParts('KRW', 98000000), { pieces: [{ number: '9800', mark: '만' }], unit: 'KRW' });
  assert.deepEqual(priceParts('KRW', 4512000), { pieces: [{ number: '4,512,000', mark: '' }], unit: 'KRW' });
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
