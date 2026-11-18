import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overwriteGetLocale, locales, baseLocale } from '../../src/paraglide/runtime.js';
import { priceParts, price, tabTitle } from '../../src/lib/format.js';
import { describeState } from '../../src/lib/status.js';
import { describeMarket } from '../../src/lib/feed.js';
import { EXCHANGES } from '../../src/lib/exchanges/index.js';
import { m } from '../../src/paraglide/messages.js';

overwriteGetLocale(() => 'en');
const read = locale => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'));
// The text of a message: a plain string, or every variant of a plural one.
const texts = value => typeof value === 'string' ? [value] : value.flatMap(entry => Object.values(entry.match));
const names = value => [...new Set(texts(value).flatMap(text => [...text.matchAll(/\{(\w+)\}/g)].map(found => found[1])))].sort();

test('English and Korean, English first: a device in neither language reads English', () => {
  assert.deepEqual([...locales].sort(), ['en', 'ko']);
  assert.equal(baseLocale, 'en');
});
test('every message exists in both languages, is not empty, and takes the same values', () => {
  const en = read('en'), ko = read('ko');
  delete en.$schema; delete ko.$schema;
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    for (const [locale, value] of [['en', en[key]], ['ko', ko[key]]]) assert.ok(texts(value).every(text => text.trim()), `${locale}.${key} is empty`);
    assert.deepEqual(names(ko[key]), names(en[key]), `${key}: the same values in both`);
  }
});
test('English text has no Korean in it', () => {
  const en = read('en'); delete en.$schema;
  for (const [key, value] of Object.entries(en)) assert.doesNotMatch(texts(value).join(' '), /[가-힣]/, key);
});
test('won for readers of English: millions and billions, four significant figures', () => {
  const won = value => priceParts('KRW', value).pieces.map(piece => piece.number + piece.mark).join(' ');
  assert.equal(won(123456789), '123.5M');
  assert.equal(won(89960000), '89.96M');
  assert.equal(won(1234567), '1.235M');
  assert.equal(won(1234567890), '1.235B');
  assert.equal(won(999950), '1.000M', 'rounding carries into millions');
  assert.equal(won(999499), '999,499');
  assert.equal(won(152300), '152,300');
  assert.equal(won(12.345), '12.35');
  assert.equal(priceParts('KRW', 89960000, 'ko').pieces[0].mark, '만', 'Korean keeps 억 and 만');
  assert.equal(price('KRW', 89960000), '89.96M KRW');
  assert.equal(tabTitle(describeMarket('KRW', 'BTC'), { price: 89960000 }), '89.96M | BTCKRW | Coinboard');
  assert.equal(price('USDT', 70123.4), '70,123 USDT', 'USDT is the same in both');
});
test('settings speak English: markets, states and their reasons', () => {
  assert.deepEqual(Object.values(EXCHANGES).map(exchange => exchange.choice), ['Upbit · KRW', 'Bithumb · KRW', 'Binance · USDT', 'Binance · USDT Perpetual', 'OKX · USDT', 'OKX · USDT Perpetual', 'Coinbase · USD']);
  const selection = describeMarket('USDT', 'BTC');
  assert.equal(describeState({ kind: 'live', selection }, 0).text, 'Binance · Live');
  const last = { price: 70123.4, receivedAt: 0, selection };
  const delayed = describeState({ kind: 'backoff', cause: 'stale', reason: m.reason_stale(), retryAt: 3000, selection, last }, 1000);
  assert.equal(delayed.text, 'Binance · Prices stopped arriving · Reconnecting in 2 seconds');
  assert.equal(delayed.detail, 'Last price 70,123 USDT, 1 second ago\nPrices stopped arriving');
  assert.match(describeState({ kind: 'backoff', cause: 'timeout', reason: m.reason_timeout(), retryAt: 1000, selection, last }, 0).text, /Reconnecting in 1 second$/, 'one second, singular');
});
