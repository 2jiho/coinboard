import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarketList } from '../../src/lib/markets.js';

const UPBIT = [{ market: 'KRW-BTC' }, { market: 'KRW-ETH' }, { market: 'BTC-ETH' }, { market: 'USDT-BTC' }, { market: 'KRW-XRP' }];
const BINANCE = [{ symbol: 'BTCUSDT', price: '1' }, { symbol: 'ETHBTC', price: '1' }, { symbol: 'ETHUSDT', price: '1' }, { symbol: 'USDTTRY', price: '1' }, { symbol: '1INCHUSDT', price: '1' }];
function fixture(answers) {
  const asked = [];
  const list = createMarketList({ fetch: async url => {
    asked.push(url);
    const answer = answers[new URL(url).host];
    if (answer instanceof Error) throw answer;
    return { ok: answer.ok !== false, json: async () => answer.body };
  } });
  return { list, asked };
}

test('Upbit: the coins of the KRW market, sorted', async () => {
  const f = fixture({ 'api.upbit.com': { body: UPBIT } });
  assert.deepEqual(await f.list.load('KRW'), ['BTC', 'ETH', 'XRP']);
  assert.deepEqual(f.asked, ['https://api.upbit.com/v1/market/all']);
});
test('Binance: the coins quoted in USDT, sorted', async () => {
  const f = fixture({ 'api.binance.com': { body: BINANCE } });
  assert.deepEqual(await f.list.load('USDT'), ['1INCH', 'BTC', 'ETH']);
  assert.deepEqual(f.asked, ['https://api.binance.com/api/v3/ticker/price']);
});
test('each exchange is asked once, however often its list is wanted', async () => {
  const f = fixture({ 'api.upbit.com': { body: UPBIT }, 'api.binance.com': { body: BINANCE } });
  await Promise.all([f.list.load('KRW'), f.list.load('KRW'), f.list.load('USDT')]);
  await f.list.load('KRW'); await f.list.load('USDT');
  assert.equal(f.asked.length, 2);
});
test('a failed or refused request gives null, and is tried again next time', async () => {
  const answers = { 'api.upbit.com': new Error('offline') };
  const f = fixture(answers);
  assert.equal(await f.list.load('KRW'), null);
  answers['api.upbit.com'] = { ok: false, body: { error: 'too many requests' } };
  assert.equal(await f.list.load('KRW'), null);
  answers['api.upbit.com'] = { body: UPBIT };
  assert.deepEqual(await f.list.load('KRW'), ['BTC', 'ETH', 'XRP']);
  assert.equal(f.asked.length, 3);
});
test('an answer in the wrong shape, or with nothing usable, gives null', async () => {
  for (const body of [{ not: 'a list' }, [], [{ market: 'BTC-ETH' }], [null, 3, { market: 'KRW-' }, { market: 'KRW-비트' }], 'text']) {
    const f = fixture({ 'api.upbit.com': { body } });
    assert.equal(await f.list.load('KRW'), null, JSON.stringify(body));
  }
});
test('duplicates and junk entries are dropped', async () => {
  const f = fixture({ 'api.upbit.com': { body: [{ market: 'KRW-ETH' }, { market: 'KRW-ETH' }, {}, { market: 'KRW-btc' }, { market: 'KRW-BTC' }] } });
  assert.deepEqual(await f.list.load('KRW'), ['BTC', 'ETH']);
});
test('the list request takes its turn with the price connection: it waits, then counts as a request itself', async () => {
  // Measured on the live site: Upbit refuses a browser request made within
  // ten seconds of the last one, and the price connection is one of them.
  const events = []; let wait = 7000;
  const pacer = { waitFor: () => wait, mark: currency => { events.push('mark ' + currency); } };
  const list = createMarketList({ pacer, sleep: async ms => { events.push('sleep ' + ms); wait = 0; },
    fetch: async () => { events.push('fetch'); return { ok: true, json: async () => UPBIT }; } });
  assert.deepEqual(await list.load('KRW'), ['BTC', 'ETH', 'XRP']);
  assert.deepEqual(events, ['sleep 7000', 'mark KRW', 'fetch']);
});
test('if something else used the turn while it waited, it waits again', async () => {
  const waits = [5000, 3000, 0], events = [];
  const pacer = { waitFor: () => waits[0], mark: () => { events.push('mark'); } };
  const list = createMarketList({ pacer, sleep: async ms => { events.push('sleep ' + ms); waits.shift(); },
    fetch: async () => { events.push('fetch'); return { ok: true, json: async () => UPBIT }; } });
  await list.load('KRW');
  assert.deepEqual(events, ['sleep 5000', 'sleep 3000', 'mark', 'fetch']);
});
