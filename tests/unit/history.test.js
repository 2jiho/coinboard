import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, PERIODS } from '../../src/lib/history.js';
import { EXCHANGES } from '../../src/lib/exchanges/index.js';
import { overwriteGetLocale } from '../../src/paraglide/runtime.js';
overwriteGetLocale(() => 'ko');

const NOW = 1_800_000_000_000;
function fixture(answers) {
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    const host = Object.keys(answers).find(key => url.includes(key));
    const answer = host && answers[host];
    if (!answer) throw new Error('unreachable');
    return { ok: answer.ok !== false, json: async () => answer.body };
  };
  let time = NOW;
  return { asked, history: createHistory({ fetch, now: () => time }), advance: ms => { time += ms; } };
}
const minutesAgo = n => NOW - n * 60e3;

test('each exchange asks for candles of the period\'s size and reads closing prices, oldest first', async () => {
  const cases = [
    ['KRW', 'api.upbit.com', 'minutes/15?market=KRW-BTC&count=97', [{ candle_date_time_utc: new Date(minutesAgo(15)).toISOString().slice(0, 19), trade_price: 2 }, { candle_date_time_utc: new Date(minutesAgo(30)).toISOString().slice(0, 19), trade_price: 1 }]],
    ['BITHUMB-KRW', 'api.bithumb.com', 'minutes/15?market=KRW-BTC', [{ candle_date_time_utc: new Date(minutesAgo(15)).toISOString().slice(0, 19), trade_price: 2 }, { candle_date_time_utc: new Date(minutesAgo(30)).toISOString().slice(0, 19), trade_price: 1 }]],
    ['USDT', 'data-api.binance.vision', 'klines?symbol=BTCUSDT&interval=15m&limit=97', [[minutesAgo(30), '0', '0', '0', '1'], [minutesAgo(15), '0', '0', '0', '2']]],
    ['USDT-PERP', 'fapi.binance.com', 'fapi/v1/klines?symbol=BTCUSDT&interval=15m', [[minutesAgo(30), '0', '0', '0', '1'], [minutesAgo(15), '0', '0', '0', '2']]],
    ['OKX-USDT', 'www.okx.com', 'instId=BTC-USDT&bar=15m&limit=97', { data: [[String(minutesAgo(15)), '0', '0', '0', '2'], [String(minutesAgo(30)), '0', '0', '0', '1']] }],
    ['OKX-USDT-PERP', 'www.okx.com', 'instId=BTC-USDT-SWAP&bar=15m', { data: [[String(minutesAgo(15)), '0', '0', '0', '2'], [String(minutesAgo(30)), '0', '0', '0', '1']] }],
    ['COINBASE-USD', 'api.exchange.coinbase.com', 'BTC-USD/candles?granularity=900', [[minutesAgo(15) / 1000, 0, 0, 0, 2], [minutesAgo(30) / 1000, 0, 0, 0, 1]]],
  ];
  for (const [currency, host, wanted, body] of cases) {
    const f = fixture({ [host]: { body } });
    const points = await f.history.load(currency, 'BTC', '1d');
    assert.ok(f.asked[0].includes(wanted), `${currency}: ${f.asked[0]}`);
    assert.deepEqual(points.map(point => point[1]), [1, 2], currency);
    assert.ok(points[0][0] < points[1][0], currency);
  }
});
test('the month is drawn from 4-hour candles, 6-hour ones on Coinbase', async () => {
  const f = fixture({ 'data-api.binance.vision': { body: [] }, 'api.exchange.coinbase.com': { body: [] } });
  await f.history.load('USDT', 'BTC', '1M'); await f.history.load('COINBASE-USD', 'BTC', '1M');
  assert.match(f.asked[0], /interval=4h&limit=181/);
  assert.match(f.asked[1], /granularity=21600/);
});
test('only the period is kept; nothing usable is null', async () => {
  const f = fixture({ 'data-api.binance.vision': { body: [[minutesAgo(120), 0, 0, 0, '9'], [minutesAgo(50), 0, 0, 0, '1'], [minutesAgo(10), 0, 0, 0, '2'], [minutesAgo(5), 0, 0, 0, 'x']] } });
  assert.deepEqual((await f.history.load('USDT', 'BTC', '1h')).map(point => point[1]), [1, 2]);
  const empty = fixture({ 'data-api.binance.vision': { body: [] } });
  assert.equal(await empty.history.load('USDT', 'BTC', '1h'), null);
});
test('a blocked address gives way to the next', async () => {
  const f = fixture({ 'api.binance.com': { body: [[minutesAgo(30), 0, 0, 0, '1'], [minutesAgo(15), 0, 0, 0, '2']] } });
  const points = await f.history.load('USDT', 'BTC', '1d');
  assert.equal(f.asked.length, 2); assert.match(f.asked[1], /^https:\/\/api\.binance\.com\//);
  assert.equal(points.length, 2);
});
test('an answer is kept while fresh: a candle\'s time, at least a minute', async () => {
  const f = fixture({ 'data-api.binance.vision': { body: [[minutesAgo(30), 0, 0, 0, '1'], [minutesAgo(15), 0, 0, 0, '2']] } });
  await f.history.load('USDT', 'BTC', '1d'); await f.history.load('USDT', 'BTC', '1d');
  assert.equal(f.asked.length, 1);
  f.advance(15 * 60e3);
  await f.history.load('USDT', 'BTC', '1d');
  assert.equal(f.asked.length, 2);
  assert.equal(PERIODS['1d'].bar, 15);
});
test('every exchange can draw a chart', () => {
  for (const [key, exchange] of Object.entries(EXCHANGES)) assert.equal(typeof exchange.candles, 'function', key);
});
test('a live price moves the latest candle, or starts the next, and old points go', async () => {
  const { extend } = await import('../../src/lib/history.js');
  const minute = 60e3, start = NOW - 60 * minute;
  const points = Array.from({ length: 60 }, (_, i) => [start + i * minute, 100 + i]);
  const moved = extend(points, NOW - 30e3, 500, '1h');
  assert.equal(moved.length, 60); assert.deepEqual(moved.at(-1), [points.at(-1)[0], 500]);
  assert.equal(extend(moved, NOW - 20e3, 500, '1h'), moved, 'the same price changes nothing');
  const next = extend(moved, NOW + 2 * minute, 600, '1h');
  assert.deepEqual(next.at(-1), [NOW + 2 * minute, 600]);
  assert.ok(next[0][0] >= NOW + 2 * minute - 61 * minute, 'points older than the period go');
});
test('requests take turns with the price connection, one at a time per exchange', async () => {
  const marks = [], waits = [];
  let last = -Infinity, time = NOW;
  const pacer = { waitFor: () => Math.max(0, last + 11000 - time), mark: currency => { last = time; marks.push(currency); } };
  const asked = [];
  const fetch = async url => { asked.push([url, time]); return { ok: true, json: async () => [{ candle_date_time_utc: new Date(minutesAgo(30)).toISOString().slice(0, 19), trade_price: 1 }, { candle_date_time_utc: new Date(minutesAgo(15)).toISOString().slice(0, 19), trade_price: 2 }] }; };
  const sleep = async ms => { waits.push(ms); time += ms; };
  const history = createHistory({ fetch, now: () => time, pacer, sleep });
  pacer.mark('KRW'); // the price connection took the first turn
  await Promise.all([history.load('KRW', 'BTC', '1d'), history.load('KRW', 'ETH', '1d')]);
  assert.equal(asked.length, 2);
  assert.ok(asked[1][1] - asked[0][1] >= 11000, 'eleven seconds between Upbit requests');
  assert.ok(asked[0][1] - NOW >= 11000, 'and after the price connection');
  assert.deepEqual(marks, ['KRW', 'KRW', 'KRW']);
});
test('a failure is asked again a minute later, an answer only after ten minutes', async () => {
  let ok = false; const asked = [];
  let time = NOW;
  const fetch = async url => { asked.push(url); return ok ? { ok: true, json: async () => [[minutesAgo(30), 0, 0, 0, '1'], [minutesAgo(15), 0, 0, 0, '2']] } : { ok: false }; };
  const history = createHistory({ fetch, now: () => time });
  assert.equal(await history.load('USDT-PERP', 'BTC', '1h'), null);
  time += 30e3; await history.load('USDT-PERP', 'BTC', '1h'); assert.equal(asked.length, 1);
  time += 31e3; ok = true; await history.load('USDT-PERP', 'BTC', '1h'); assert.equal(asked.length, 2);
  time += 5 * 60e3; await history.load('USDT-PERP', 'BTC', '1h'); assert.equal(asked.length, 2, 'a 1-minute chart is not asked for every minute');
  time += 6 * 60e3; await history.load('USDT-PERP', 'BTC', '1h'); assert.equal(asked.length, 3);
});
