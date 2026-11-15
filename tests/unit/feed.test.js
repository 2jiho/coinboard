import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarketFeed, describeMarket } from '../../src/lib/feed.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}) {
  let time = 1800000000000, id = 0;
  const timers = new Map(), sockets = [], states = [], ticks = [];
  const clock = {
    now: () => time,
    setTimeout(cb, ms) { const key = ++id; timers.set(key, { cb, at: time + ms }); return key; },
    clearTimeout(key) { timers.delete(key); },
    setInterval(cb, ms) { const key = ++id; timers.set(key, { cb, at: time + ms, interval: ms }); return key; },
    clearInterval(key) { timers.delete(key); },
  };
  function advance(ms) {
    const end = time + ms;
    for (let count = 0; count < 10000; count++) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { time = end; return; }
      const [key, timer] = next; time = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(key);
      timer.cb();
    }
    throw new Error('Timer loop');
  }
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; this.createdAt = time; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(text) { this.sent.push(text); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const feed = createMarketFeed({ WebSocket: Socket, clock, onState: state => states.push(state),
    onTick: tick => ticks.push(tick), random: () => 0, attemptStore: null, ...extra });
  function tick(currency = 'KRW', values = {}) {
    return currency === 'KRW' ? { type: 'ticker', code: 'KRW-BTC', trade_price: 98000000,
      signed_change_rate: -0.025, timestamp: time, ...values } :
      { e: '24hrTicker', s: 'BTCUSDT', c: '70000.10', P: '2.5', E: time, ...values };
  }
  async function message(data, connection = sockets.at(-1), binary = false) {
    let payload = JSON.stringify(data);
    if (binary) payload = new TextEncoder().encode(payload).buffer;
    await connection.onmessage?.({ data: payload }); await flush();
  }
  return { feed, clock, timers, sockets, states, ticks, advance, tick, message, now: () => time, state: () => states.at(-1) };
}
test('Upbit KRW-BTC subscription and binary ticker use actual KRW and signed daily change', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  assert.equal(f.sockets[0].url, 'wss://api.upbit.com/websocket/v1');
  assert.deepEqual(JSON.parse(f.sockets[0].sent[0])[1], { type: 'ticker', codes: ['KRW-BTC'] });
  assert.equal(f.state().kind, 'waiting'); await f.message(f.tick(), undefined, true);
  assert.equal(f.ticks[0].price, 98000000); assert.equal(f.ticks[0].change, -2.5);
  assert.equal(f.ticks[0].selection.changeLabel, '1D'); assert.equal(f.state().kind, 'live');
});
test('Binance pushed ticker uses USDT and 24h change; no price requests or JSON ping', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open();
  assert.equal(f.sockets[0].url, 'wss://stream.binance.com:443/ws/btcusdt@ticker');
  await f.message(f.tick('USDT')); assert.equal(f.ticks[0].price, 70000.1);
  assert.equal(f.ticks[0].selection.currency, 'USDT'); assert.equal(f.ticks[0].selection.changeLabel, '24H');
  assert.deepEqual(f.sockets[0].sent, []);
});
test('switch clears data and ignores delayed Blob decode and old socket events', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); const old = f.sockets[0]; old.open(); await f.message(f.tick());
  let resolve; const oldMessage = old.onmessage, oldClose = old.onclose, oldOpen = old.onopen;
  const delayed = oldMessage({ data: { text: () => new Promise(r => { resolve = r; }) } });
  f.feed.select('USDT', 'BTC'); f.sockets[1].open(); assert.equal(f.state().last, null); assert.equal(old.readyState, 3);
  resolve(JSON.stringify(f.tick())); await delayed; oldClose(); oldOpen();
  assert.equal(f.ticks.length, 1); assert.equal(f.sockets.length, 2);
  await f.message(f.tick('USDT')); assert.equal(f.ticks.at(-1).selection.currency, 'USDT');
});
test('rapid repeated switches obey source limits and connect only final selection', () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.feed.select('USDT', 'BTC');
  for (let n = 0; n < 100; n++) { f.feed.select('KRW', 'BTC'); f.feed.select('USDT', 'BTC'); }
  f.feed.select('KRW', 'BTC'); assert.equal(f.sockets.length, 2);
  f.advance(9999); assert.equal(f.sockets.length, 2); f.advance(1); assert.equal(f.sockets.length, 3);
  assert.equal(f.sockets[2].createdAt - f.sockets[0].createdAt, 10000);
  assert.equal(f.sockets.filter(s => s.readyState !== 3).length, 1);
});
test('network errors schedule one capped backoff; old close cannot duplicate it', () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); const oldError = f.sockets[0].onerror, oldClose = f.sockets[0].onclose;
  oldError(); oldClose(); assert.equal(f.timers.size, 1); f.advance(2000); assert.equal(f.sockets.length, 2);
  for (let n = 0; n < 10; n++) {
    f.sockets.at(-1).onerror();
    const delay = f.state().retryAt - f.now(); assert.ok(delay <= 30000); f.advance(delay);
  }
});
test('malformed, wrong-pair and nonfinite values do not prove freshness', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open();
  for (const bad of [{ s: 'ETHUSDT' }, { c: 'Infinity' }, { c: '-1' }, { c: true }, { P: 'NaN' }, { P: null }, { P: '' }, { E: 0 }, { E: null }]) await f.message(f.tick('USDT', bad));
  await f.sockets[0].onmessage({ data: 'not-json' }); assert.equal(f.ticks.length, 0); assert.equal(f.state().kind, 'waiting');
  f.advance(15000); assert.equal(f.state().kind, 'backoff'); assert.match(f.state().reason, /시간 초과/);
});
test('out-of-order ticker cannot overwrite newer price', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open(); await f.message(f.tick('USDT'));
  await f.message(f.tick('USDT', { E: f.now() - 1000, c: '1' })); assert.equal(f.ticks.length, 1);
});
test('background/offline cancel timers and resume waits for new data', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open(); await f.message(f.tick());
  f.feed.setActive(false); assert.equal(f.timers.size, 0); assert.equal(f.state().kind, 'paused');
  f.advance(60000); assert.equal(f.sockets.length, 1);
  f.feed.setActive(true); f.feed.setActive(true); f.sockets[1].open(); assert.equal(f.state().kind, 'waiting');
  f.feed.setOnline(false); assert.equal(f.timers.size, 0); f.advance(60000); assert.equal(f.sockets.length, 2);
  f.feed.setOnline(true); f.sockets[2].open(); await f.message(f.tick()); assert.equal(f.state().kind, 'live');
  f.feed.dispose(); assert.equal(f.timers.size, 0); f.advance(60000); assert.equal(f.sockets.length, 3);
});
test('parameter error stops retries; rate limit waits at least 30 seconds', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  await f.message({ error: { name: 'INVALID_PARAM' } }); assert.equal(f.state().kind, 'error');
  f.advance(60000); assert.equal(f.sockets.length, 1); assert.equal(f.timers.size, 0);
  f.feed.retry(); f.sockets[1].open(); await f.message({ error: { name: 'TOO_MANY_REQUEST' } });
  assert.equal(f.state().retryAt - f.now(), 30000);
});
test('Binance server shutdown reconnects; unchanged selection does not', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open(); f.feed.select('USDT', 'BTC');
  assert.equal(f.sockets.length, 1); await f.message({ e: 'serverShutdown' }); f.advance(2000); assert.equal(f.sockets.length, 2);
});
test('constructor failure and reload cooldown do not loop', () => {
  const broken = fixture({ WebSocket: class { constructor() { throw new Error('Blocked'); } } });
  broken.feed.select('KRW', 'BTC'); assert.equal(broken.timers.size, 1); assert.equal(broken.state().kind, 'backoff');
  const f = fixture({ attemptStore: { getItem: () => '1800000000000', setItem() {} } });
  f.feed.select('KRW', 'BTC'); assert.equal(f.sockets.length, 0); f.advance(10000); assert.equal(f.sockets.length, 1);
});
test('Upbit quiet market: UP replies keep the connection for 60s without a new trade', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open(); await f.message(f.tick());
  for (let n = 0; n < 6; n++) { f.advance(10000); assert.equal(f.sockets[0].sent.at(-1), 'PING'); await f.message({ status: 'UP' }); }
  assert.equal(f.sockets.length, 1); assert.equal(f.state().kind, 'live'); assert.equal(f.ticks.length, 1);
});
test('UP replies do not extend the first-tick deadline', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  f.advance(10000); await f.message({ status: 'UP' }); f.advance(4999); assert.equal(f.state().kind, 'waiting');
  f.advance(1); assert.equal(f.state().kind, 'backoff'); assert.match(f.state().reason, /시세 수신 시간 초과/);
});
test('Upbit connection that goes silent after a tick reconnects within staleMs', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open(); await f.message(f.tick());
  f.advance(14000); assert.equal(f.state().kind, 'live');
  f.advance(1000); assert.equal(f.state().kind, 'backoff'); assert.match(f.state().reason, /시세 업데이트 지연/);
  assert.equal(f.state().last.price, 98000000);
});
test('Binance has no visible heartbeat: silence after a tick reconnects, UP-like noise does not count', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open(); await f.message(f.tick('USDT'));
  f.advance(14000); await f.message({ status: 'UP' }); f.advance(1000);
  assert.equal(f.state().kind, 'backoff'); assert.match(f.state().reason, /시세 업데이트 지연/);
});
test('device clock 5 minutes ahead or behind the exchange still shows live prices', async () => {
  for (const skew of [300000, -300000]) {
    const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
    await f.message(f.tick('KRW', { timestamp: f.now() + skew }));
    assert.equal(f.ticks.length, 1); assert.equal(f.state().kind, 'live');
    f.advance(5000); await f.message(f.tick('KRW', { timestamp: f.now() + skew, trade_price: 98100000 }));
    assert.equal(f.ticks.length, 2); assert.equal(f.state().kind, 'live'); assert.equal(f.sockets.length, 1);
  }
});
test('old trade time on a quiet market is live, not a delay', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  await f.message(f.tick('KRW', { timestamp: f.now() - 120000 }));
  assert.equal(f.state().kind, 'live'); assert.equal(f.states.some(s => s.kind === 'backoff'), false);
});
test('out-of-order guard does not outlive the connection', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open();
  await f.message(f.tick('USDT', { E: f.now() + 900000 })); assert.equal(f.ticks.length, 1);
  f.sockets[0].onclose(); f.advance(2000); f.sockets[1].open();
  await f.message(f.tick('USDT', { c: '70001.00' }));
  assert.equal(f.ticks.length, 2); assert.equal(f.ticks[1].price, 70001); assert.equal(f.state().kind, 'live');
});
test('Upbit text PING at open and every 10s, no repeated subscription', async () => {
  // Measured against the live API: after the first PING Upbit sends {"status":"UP"}
  // every 10s on its own schedule, so the first PING must not wait 10s.
  const f = fixture({ staleMs: 45000 }); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  assert.deepEqual(f.sockets[0].sent.slice(1), ['PING']); await f.message(f.tick());
  f.advance(10000); assert.deepEqual(f.sockets[0].sent.slice(1), ['PING', 'PING']);
  f.advance(20000); assert.deepEqual(f.sockets[0].sent.slice(1), ['PING', 'PING', 'PING', 'PING']);
});
test('two first-tick timeouts on a never-seen ticker mark it suspect; a tick clears it', async () => {
  const f = fixture(); f.feed.select('USDT', 'NOPE'); f.sockets[0].open();
  assert.equal(f.state().tickerSuspect, false);
  f.advance(15000); assert.match(f.state().reason, /시세 수신 시간 초과/); assert.equal(f.state().tickerSuspect, false);
  f.advance(f.state().retryAt - f.now()); f.sockets[1].open(); f.advance(15000);
  assert.equal(f.state().kind, 'backoff'); assert.equal(f.state().tickerSuspect, true);
  f.advance(f.state().retryAt - f.now()); assert.equal(f.sockets.length, 3); f.sockets[2].open();
  assert.equal(f.state().tickerSuspect, true);
  await f.message(f.tick('USDT', { s: 'NOPEUSDT' })); assert.equal(f.state().kind, 'live'); assert.equal(f.state().tickerSuspect, false);
});
test('a ticker that has delivered prices is not suspect after timeouts; switching resets suspicion', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open(); await f.message(f.tick('USDT'));
  for (let n = 0; n < 3; n++) { f.advance(15000); f.advance(f.state().retryAt - f.now()); f.sockets.at(-1).open(); }
  f.advance(15000); assert.equal(f.state().kind, 'backoff'); assert.equal(f.state().tickerSuspect, false);
  const g = fixture(); g.feed.select('USDT', 'NOPE'); g.sockets[0].open(); g.advance(15000);
  g.advance(g.state().retryAt - g.now()); g.sockets[1].open(); g.advance(15000); assert.equal(g.state().tickerSuspect, true);
  g.feed.select('USDT', 'BTC'); assert.equal(g.state().tickerSuspect, false);
});
test('Binance error replies in either shape stop retries', async () => {
  for (const reply of [{ code: -1121, msg: 'Invalid symbol.' }, { error: { code: 2, msg: 'Invalid request' } }, { error: { name: 'INVALID_PARAM' } }]) {
    const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open();
    await f.message(reply); assert.equal(f.state().kind, 'error', JSON.stringify(reply));
    f.advance(60000); assert.equal(f.sockets.length, 1);
  }
});
test('describeMarket names a market the way each part of the app needs it', () => {
  assert.deepEqual(describeMarket('KRW', 'BTC'), { currency: 'KRW', ticker: 'BTC', quote: 'KRW', tag: '', symbol: 'BTCKRW', exchange: '업비트', label: 'UPBIT', market: 'KRW-BTC', pair: 'KRW-BTC', changeLabel: '1D' });
  assert.deepEqual(describeMarket('USDT', 'ETH'), { currency: 'USDT', ticker: 'ETH', quote: 'USDT', tag: '', symbol: 'ETHUSDT', exchange: '바이낸스', label: 'BINANCE', market: 'ETHUSDT', pair: 'ETH/USDT', changeLabel: '24H' });
  // A perpetual future is its own market: priced in USDT, marked PERP.
  assert.deepEqual(describeMarket('USDT-PERP', 'BTC'), { currency: 'USDT-PERP', ticker: 'BTC', quote: 'USDT', tag: 'PERP', symbol: 'BTCUSDTPERP', exchange: '바이낸스 선물', label: 'BINANCE FUTURES', market: 'BTCUSDT', pair: 'BTC/USDT PERP', changeLabel: '24H' });
});
test('every state says why in a code as well as in words', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open();
  assert.equal(f.state().cause, null);
  f.advance(15000); assert.equal(f.state().kind, 'backoff'); assert.equal(f.state().cause, 'timeout');
  f.advance(f.state().retryAt - f.now()); f.sockets[1].open(); await f.message(f.tick('USDT'));
  assert.equal(f.state().kind, 'live'); assert.equal(f.state().cause, null);
  f.advance(15000); assert.equal(f.state().cause, 'stale'); assert.match(f.state().reason, /시세 업데이트 지연/);
  f.advance(f.state().retryAt - f.now()); f.sockets[2].onclose(); assert.equal(f.state().cause, 'closed');
  f.advance(f.state().retryAt - f.now()); f.sockets[3].onerror(); assert.equal(f.state().cause, 'network');
  f.advance(f.state().retryAt - f.now()); f.sockets[4].open(); await f.message({ e: 'serverShutdown' }); assert.equal(f.state().cause, 'restart');
  f.advance(f.state().retryAt - f.now()); f.sockets[5].open(); await f.message({ code: -1121, msg: 'Invalid symbol.' });
  assert.equal(f.state().kind, 'error'); assert.equal(f.state().cause, 'exchange-error');
  f.feed.setOnline(false); assert.equal(f.state().cause, 'offline');
  f.feed.setOnline(true); f.feed.setActive(false); assert.equal(f.state().cause, 'hidden');
});
test('Binance perpetual futures: their own stream, the same ticker message, USDT prices', async () => {
  const f = fixture(); f.feed.select('USDT-PERP', 'BTC'); f.sockets[0].open();
  assert.equal(f.sockets[0].url, 'wss://fstream.binance.com/market/ws/btcusdt@ticker');
  assert.deepEqual(f.sockets[0].sent, []);
  await f.message(f.tick('USDT', { c: '70111.50', P: '-1.25' }));
  assert.equal(f.ticks[0].price, 70111.5); assert.equal(f.ticks[0].change, -1.25);
  assert.equal(f.ticks[0].selection.quote, 'USDT'); assert.equal(f.ticks[0].selection.tag, 'PERP');
  assert.equal(f.state().kind, 'live'); assert.equal(f.state().selection.exchange, '바이낸스 선물');
});
test('spot and futures of the same coin are different selections, each paced on its own', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.feed.select('USDT-PERP', 'BTC');
  assert.equal(f.sockets.length, 2); assert.match(f.sockets[1].url, /^wss:\/\/fstream\.binance\.com\//);
  assert.throws(() => f.feed.select('USD', 'BTC'), /Invalid market selection/);
});
