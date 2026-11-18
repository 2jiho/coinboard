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
