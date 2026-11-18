import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXCHANGES, MARKET_GROUPS } from '../../src/lib/exchanges/index.js';
import { overwriteGetLocale } from '../../src/paraglide/runtime.js';
overwriteGetLocale(() => 'ko');
const { 'BITHUMB-KRW': bithumb, 'OKX-USDT': okx, 'OKX-USDT-PERP': okxSwap, 'COINBASE-USD': coinbase, 'BYBIT-USDT': bybit, 'BYBIT-USDT-PERP': bybitLinear, 'KRAKEN-USD': kraken, 'COINONE-KRW': coinone } = EXCHANGES;

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

test('Bybit: one coin a request, 24-hour change as a fraction, perpetual updates without a price', () => {
  assert.equal(bybit.market('BTC'), 'BTCUSDT'); assert.equal(bybit.url(), 'wss://stream.bybit.com/v5/public/spot');
  assert.equal(bybitLinear.url(), 'wss://stream.bybit.com/v5/public/linear');
  assert.deepEqual(bybit.subscribe(['BTCUSDT', 'ETHUSDT']).map(frame => JSON.parse(frame)), [{ op: 'subscribe', args: ['tickers.BTCUSDT'] }, { op: 'subscribe', args: ['tickers.ETHUSDT'] }]);
  assert.deepEqual(bybit.resubscribe(['BTCUSDT', 'ETHUSDT'], ['BTCUSDT', 'SOLUSDT']).map(frame => JSON.parse(frame)), [{ op: 'unsubscribe', args: ['tickers.ETHUSDT'] }, { op: 'subscribe', args: ['tickers.SOLUSDT'] }]);
  const tick = bybit.read({ topic: 'tickers.BTCUSDT', ts: 5, type: 'snapshot', data: { symbol: 'BTCUSDT', lastPrice: '64680.1', price24hPcnt: '0.0123' } });
  assert.equal(tick.type, 'tick'); assert.equal(tick.market, 'BTCUSDT'); assert.equal(tick.price, 64680.1); assert.ok(Math.abs(tick.change - 1.23) < 1e-9); assert.equal(tick.eventTime, 5);
  bybitLinear.read({ topic: 'tickers.BTCUSDT', ts: 1, type: 'snapshot', data: { symbol: 'BTCUSDT', lastPrice: '100', price24hPcnt: '0.02' } });
  assert.deepEqual(bybitLinear.read({ topic: 'tickers.BTCUSDT', ts: 2, type: 'delta', data: { symbol: 'BTCUSDT', bid1Price: '99' } }), { type: 'alive' });
  const moved = bybitLinear.read({ topic: 'tickers.BTCUSDT', ts: 3, type: 'delta', data: { symbol: 'BTCUSDT', lastPrice: '101' } });
  assert.equal(moved.price, 101); assert.equal(moved.change, 2, 'the last change is kept');
  assert.deepEqual(bybit.read({ success: true, ret_msg: 'pong', op: 'ping' }), { type: 'alive' });
  assert.deepEqual(bybit.read({ success: false, ret_msg: 'Invalid symbol :[tickers.NOPEUSDT]', op: 'subscribe' }), { type: 'unlisted', market: 'NOPEUSDT' });
  assert.deepEqual(bybitLinear.read({ success: false, ret_msg: 'error:handler not found,topic:tickers.NOPEUSDT', op: 'subscribe' }), { type: 'unlisted', market: 'NOPEUSDT' });
  assert.equal(bybit.read({ success: true, ret_msg: 'subscribe', op: 'subscribe' }), null);
  assert.equal(bybit.listedTicker({ symbol: 'SOLUSDT', baseCoin: 'SOL', quoteCoin: 'USDT', status: 'Trading' }), 'SOL');
  assert.equal(bybitLinear.listedTicker({ symbol: 'SOLUSDT', baseCoin: 'SOL', quoteCoin: 'USDT', status: 'Trading', contractType: 'LinearFutures' }), null);
  assert.equal(bybitLinear.listedTicker({ symbol: 'SOLUSDT', baseCoin: 'SOL', quoteCoin: 'USDT', status: 'Trading', contractType: 'LinearPerpetual' }), 'SOL');
  const { url, parse } = bybit.candles('BTC', 15, 200);
  assert.match(url[0], /api\.bybit\.com\/v5\/market\/kline\?category=spot&symbol=BTCUSDT&interval=15&limit=200/); assert.match(url[1], /api\.bytick\.com/);
  assert.deepEqual(parse({ result: { list: [['2000', '1', '1', '1', '7'], ['1000', '1', '1', '1', '6']] } }), [[2000, 7], [1000, 6]]);
});

test('Kraken: v2 ticker, heartbeat, an unknown pair refused alone, old coin names in the list', () => {
  assert.equal(kraken.market('BTC'), 'BTC/USD');
  assert.deepEqual(JSON.parse(kraken.subscribe(['BTC/USD'])[0]), { method: 'subscribe', params: { channel: 'ticker', symbol: ['BTC/USD'] } });
  assert.deepEqual(kraken.resubscribe(['BTC/USD'], ['ETH/USD']).map(frame => JSON.parse(frame).method), ['unsubscribe', 'subscribe']);
  const tick = kraken.read({ channel: 'ticker', type: 'snapshot', data: [{ symbol: 'BTC/USD', last: 64609.2, change_pct: 0.3, timestamp: '2026-11-18T09:43:11.191355Z' }] });
  assert.deepEqual(tick, { type: 'tick', market: 'BTC/USD', price: 64609.2, change: 0.3, eventTime: Date.parse('2026-11-18T09:43:11.191Z') });
  assert.deepEqual(kraken.read({ channel: 'heartbeat' }), { type: 'alive' });
  assert.deepEqual(kraken.read({ error: 'Currency pair not supported NOPE/USD', method: 'subscribe', success: false, symbol: 'NOPE/USD' }), { type: 'unlisted', market: 'NOPE/USD' });
  assert.equal(kraken.read({ channel: 'status', type: 'update', data: [{ system: 'online' }] }), null);
  assert.equal(kraken.listedTicker({ wsname: 'XBT/USD', status: 'online' }), 'BTC');
  assert.equal(kraken.listedTicker({ wsname: 'XDG/USD', status: 'online' }), 'DOGE');
  assert.equal(kraken.listedTicker({ wsname: 'ETH/EUR', status: 'online' }), null);
  assert.equal(kraken.listedTicker({ wsname: 'ETH/USD', status: 'cancel_only' }), null);
  const { url, parse } = kraken.candles('BTC', 240);
  assert.equal(url, 'https://api.kraken.com/0/public/OHLC?pair=BTC%2FUSD&interval=240');
  assert.deepEqual(parse({ result: { 'BTC/USD': [[1, '1', '1', '1', '5', '1', '1', 1]], last: 1 } }), [[1000, 5]]);
});

test('Coinone: one coin a request, change from 24 hours ago, PONG, no list or chart', () => {
  assert.equal(coinone.market('BTC'), 'BTC'); assert.equal(coinone.pair('BTC'), 'KRW-BTC');
  assert.deepEqual(JSON.parse(coinone.subscribe(['BTC'])[0]), { request_type: 'SUBSCRIBE', channel: 'TICKER', topic: { quote_currency: 'KRW', target_currency: 'BTC' } });
  assert.deepEqual(coinone.resubscribe(['BTC', 'ETH'], ['BTC', 'XRP']).map(frame => JSON.parse(frame).request_type + ' ' + JSON.parse(frame).topic.target_currency), ['UNSUBSCRIBE ETH', 'SUBSCRIBE XRP']);
  const tick = coinone.read({ response_type: 'DATA', channel: 'TICKER', data: { quote_currency: 'KRW', target_currency: 'BTC', timestamp: 7, first: '100', last: '101' } });
  assert.equal(tick.market, 'BTC'); assert.equal(tick.price, 101); assert.ok(Math.abs(tick.change - 1) < 1e-9); assert.equal(tick.eventTime, 7);
  assert.deepEqual(coinone.read({ response_type: 'PONG' }), { type: 'alive' });
  assert.equal(coinone.read({ response_type: 'ERROR', error_code: 160012, message: 'Invalid Topic' }), null, 'an unknown coin does not end the connection');
  assert.equal(coinone.read({ response_type: 'SUBSCRIBED', channel: 'TICKER', data: {} }), null);
  assert.equal(coinone.listUrl, undefined); assert.equal(coinone.candles, undefined);
});
