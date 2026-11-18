import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXCHANGES, MARKET_GROUPS } from '../../src/lib/exchanges/index.js';
import { overwriteGetLocale } from '../../src/paraglide/runtime.js';
overwriteGetLocale(() => 'ko');
const { 'BITHUMB-KRW': bithumb, 'OKX-USDT': okx, 'OKX-USDT-PERP': okxSwap, 'COINBASE-USD': coinbase } = EXCHANGES;

test('every market is listed once in settings, by its currency', () => {
  const listed = MARKET_GROUPS.flatMap(group => group.keys);
  assert.deepEqual([...listed].sort(), Object.keys(EXCHANGES).sort());
  for (const group of MARKET_GROUPS) for (const key of group.keys) assert.equal(EXCHANGES[key].quote, group.quote, key);
});
test('Bithumb speaks Upbit\'s format, and keeps alive by asking again', () => {
  assert.equal(bithumb.market('BTC'), 'KRW-BTC');
  assert.deepEqual(JSON.parse(bithumb.subscribe(['KRW-BTC', 'KRW-ETH'], 1)[0])[1], { type: 'ticker', codes: ['KRW-BTC', 'KRW-ETH'] });
  assert.deepEqual(JSON.parse(bithumb.heartbeat(['KRW-BTC'], 2)[0])[1], { type: 'ticker', codes: ['KRW-BTC'] });
  assert.equal(bithumb.heartbeatAtOpen, false);
  assert.deepEqual(bithumb.read({ type: 'ticker', code: 'KRW-BTC', trade_price: 88000000, signed_change_rate: -0.0065, timestamp: 1 }),
    { type: 'tick', market: 'KRW-BTC', price: 88000000, change: -0.65, eventTime: 1 });
  assert.equal(bithumb.listedTicker({ market: 'KRW-DOGE' }), 'DOGE');
  assert.equal(bithumb.listedTicker({ market: 'BTC-ETH' }), null);
});
test('OKX: spot and swap instruments, 24-hour change, ping and pong, an unknown coin refused alone', () => {
  assert.equal(okx.market('BTC'), 'BTC-USDT'); assert.equal(okxSwap.market('BTC'), 'BTC-USDT-SWAP');
  assert.equal(okx.url(['BTC-USDT']), 'wss://ws.okx.com/ws/v5/public');
  assert.equal(okx.hosts.length, 2);
  assert.deepEqual(JSON.parse(okx.subscribe(['BTC-USDT'])[0]), { op: 'subscribe', args: [{ channel: 'tickers', instId: 'BTC-USDT' }] });
  assert.deepEqual(okx.resubscribe(['BTC-USDT', 'ETH-USDT'], ['BTC-USDT', 'SOL-USDT']).map(frame => JSON.parse(frame)), [
    { op: 'unsubscribe', args: [{ channel: 'tickers', instId: 'ETH-USDT' }] }, { op: 'subscribe', args: [{ channel: 'tickers', instId: 'SOL-USDT' }] }]);
  const tick = okx.read({ arg: { channel: 'tickers', instId: 'BTC-USDT' }, data: [{ instId: 'BTC-USDT', last: '101', open24h: '100', ts: '5' }] });
  assert.equal(tick.market, 'BTC-USDT'); assert.equal(tick.price, 101); assert.ok(Math.abs(tick.change - 1) < 1e-9); assert.equal(tick.eventTime, 5);
  assert.deepEqual(okx.read('pong'), { type: 'alive' });
  assert.equal(okx.heartbeat, 'ping');
  assert.deepEqual(okx.read({ event: 'error', code: '60018', msg: "Subscribe failed, wrong URL or channel:tickers,instId:NOPE-USDT doesn't exist. Please use the correct URL" }), { type: 'unlisted', market: 'NOPE-USDT' });
  assert.deepEqual(okx.read({ event: 'error', code: '60012', msg: 'Invalid request' }), { type: 'error', code: '60012' });
  assert.equal(okx.read({ event: 'subscribe', arg: {} }), null);
  // Lists come wrapped; swaps are the USDT-settled perpetuals.
  assert.deepEqual(okx.listEntries({ data: [1] }), [1]);
  assert.equal(okx.listedTicker({ instId: 'SOL-USDT', state: 'live' }), 'SOL');
  assert.equal(okx.listedTicker({ instId: 'SOL-USDC', state: 'live' }), null);
  assert.equal(okxSwap.listedTicker({ instId: 'SOL-USDT-SWAP', state: 'live' }), 'SOL');
  assert.equal(okxSwap.listedTicker({ instId: 'BTC-USD-SWAP', state: 'live' }), null);
});
test('Coinbase: dollars, 24-hour change, its heartbeat channel, an unknown coin refused alone', () => {
  assert.equal(coinbase.market('BTC'), 'BTC-USD'); assert.equal(coinbase.quote, 'USD');
  assert.deepEqual(JSON.parse(coinbase.subscribe(['BTC-USD'])[0]), { type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker', 'heartbeat'] });
  assert.deepEqual(coinbase.resubscribe(['BTC-USD'], ['ETH-USD']).map(frame => JSON.parse(frame).type), ['unsubscribe', 'subscribe']);
  const tick = coinbase.read({ type: 'ticker', product_id: 'BTC-USD', price: '64700', open_24h: '64000', time: '2026-11-18T08:45:26.950Z' });
  assert.equal(tick.price, 64700); assert.ok(Math.abs(tick.change - 700 / 640) < 1e-9); assert.equal(tick.eventTime, Date.parse('2026-11-18T08:45:26.950Z'));
  assert.deepEqual(coinbase.read({ type: 'heartbeat', product_id: 'BTC-USD' }), { type: 'alive' });
  assert.deepEqual(coinbase.read({ type: 'error', message: 'Failed to subscribe', reason: 'NOPE-USD is not a valid product' }), { type: 'unlisted', market: 'NOPE-USD' });
  assert.equal(coinbase.listedTicker({ base_currency: 'ETH', quote_currency: 'USD', status: 'online' }), 'ETH');
  assert.equal(coinbase.listedTicker({ base_currency: 'ETH', quote_currency: 'USDT', status: 'online' }), null);
});
