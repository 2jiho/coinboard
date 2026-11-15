import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price, priceParts, change, direction } from '../../src/lib/format.js';
test('whole-won and two-decimal USDT prices are unchanged for ordinary amounts', () => {
  assert.equal(price('KRW', 98000000), '98,000,000 KRW');
  assert.equal(price('KRW', 1234.5), '1,235 KRW');
  assert.equal(price('USDT', 65000), '65,000.00 USDT');
  assert.equal(price('USDT', 70000.1), '70,000.10 USDT');
});
test('boundary amounts follow the ordinary rule', () => {
  assert.equal(price('KRW', 100), '100 KRW');
  assert.equal(price('USDT', 1), '1.00 USDT');
});
test('sub-unit prices always show exactly four significant digits', () => {
  assert.equal(price('KRW', 12.6), '12.60 KRW');
  assert.equal(price('KRW', 0.0123), '0.01230 KRW');
  assert.equal(price('KRW', 0.012345), '0.01235 KRW');
  assert.equal(price('USDT', 0.4567), '0.4567 USDT');
  assert.equal(price('USDT', 0.5), '0.5000 USDT');
  assert.equal(price('USDT', 0.25), '0.2500 USDT');
  assert.equal(price('USDT', 0.00001234), '0.00001234 USDT');
  assert.equal(price('USDT', 0.000012345678), '0.00001235 USDT');
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
test('priceParts gives the digits and the currency code separately; the code always follows the digits', () => {
  assert.deepEqual(priceParts('KRW', 98000000), { digits: '98,000,000', unit: 'KRW' });
  assert.deepEqual(priceParts('KRW', 12.6), { digits: '12.60', unit: 'KRW' });
  assert.deepEqual(priceParts('USDT', 70000.1), { digits: '70,000.10', unit: 'USDT' });
  for (const [currency, value] of [['KRW', 98000000], ['KRW', 0.0123], ['USDT', 65000], ['USDT', 0.00001234]]) {
    const parts = priceParts(currency, value);
    assert.equal(parts.digits + ' ' + parts.unit, price(currency, value));
  }
});
