import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price, change, direction } from '../../src/lib/format.js';
test('whole-won and two-decimal USDT prices are unchanged for ordinary amounts', () => {
  assert.equal(price('KRW', 98000000), '₩98,000,000');
  assert.equal(price('KRW', 1234.5), '₩1,235');
  assert.equal(price('USDT', 65000), '65,000.00 USDT');
  assert.equal(price('USDT', 70000.1), '70,000.10 USDT');
});
test('boundary amounts follow the ordinary rule', () => {
  assert.equal(price('KRW', 100), '₩100');
  assert.equal(price('USDT', 1), '1.00 USDT');
});
test('sub-unit prices always show exactly four significant digits', () => {
  assert.equal(price('KRW', 12.6), '₩12.60');
  assert.equal(price('KRW', 0.0123), '₩0.01230');
  assert.equal(price('KRW', 0.012345), '₩0.01235');
  assert.equal(price('USDT', 0.4567), '0.4567 USDT');
  assert.equal(price('USDT', 0.5), '0.5000 USDT');
  assert.equal(price('USDT', 0.25), '0.2500 USDT');
  assert.equal(price('USDT', 0.00001234), '0.00001234 USDT');
  assert.equal(price('USDT', 0.000012345678), '0.00001235 USDT');
});
test('signed percentage change with two decimals', () => {
  assert.equal(change(1.234), '+1.23%');
  assert.equal(change(-0.5), '-0.50%');
});
test('a change that rounds to zero carries no sign and no direction', () => {
  for (const tiny of [-0.004, 0, 0.004]) { assert.equal(change(tiny), '0.00%'); assert.equal(direction(tiny), 0); }
  assert.equal(direction(0.005), 1); assert.equal(direction(-0.02), -1);
});
