// Public market data only. No keys, price polling, or currency conversion.
// What is specific to an exchange lives in ./exchanges; this file owns the
// connection: when to connect, when to give up, when a price counts as live.
import { EXCHANGES } from "./exchanges/index.js";
import { createPacer } from "./pace.js";
import { m } from "../paraglide/messages.js";

// Why the feed is not live, as a code. The words (in the reader's language) are for the settings panel;
// anything that decides behaviour or the board's wording uses the code.
const REASONS = {
  "rate-wait": m.reason_rate_wait,
  "connect-failed": m.reason_connect_failed,
  timeout: m.reason_timeout,
  stale: m.reason_stale,
  "subscribe-failed": m.reason_subscribe_failed,
  "heartbeat-failed": m.reason_heartbeat_failed,
  "rate-limited": m.reason_rate_limited,
  restart: m.reason_restart,
  network: m.reason_network,
  closed: m.reason_closed,
  hidden: m.reason_hidden,
  offline: m.reason_offline,
};

// One market, named the way each part of the app needs it.
export function describeMarket(currency, ticker) {
  const exchange = EXCHANGES[currency];
  // quote is the currency prices are in; tag marks a market that is not the
  // plain spot one (PERP); symbol is the market in one word, for the tab title.
  return { currency, ticker, quote: exchange.quote, tag: exchange.tag, symbol: ticker + exchange.quote + exchange.tag,
    exchange: exchange.name, label: exchange.label,
    market: exchange.market(ticker), pair: exchange.pair(ticker), changeLabel: exchange.changeLabel };
}

// One connection to one exchange (one market kind: KRW, USDT, USDT-PERP),
// carrying every coin the board shows there. States are reported per coin:
// the connection's state, except that a coin which has sent nothing on a live
// connection is still waiting.
export function createMarketFeed(options) {
  options = options || {};
  const WS = options.WebSocket || globalThis.WebSocket;
  const clock = options.clock || {
    now: Date.now, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis),
  };
  const onTick = options.onTick || (() => {});
  const onState = options.onState || (() => {});
  const random = options.random || Math.random;
  const staleMs = options.staleMs || 15000;
  // The coins, in order, and the same keyed by exchange market name.
  let currency = null, selections = [], byMarket = new Map();
  // Per coin: its latest price, whether it has ever sent one since it was
  // chosen, and whether it stayed silent on a connection where others spoke.
  let lasts = new Map(), everTicked = new Set(), unanswered = new Set();
  let socket = null, generation = 0;
  let retryTimer = null, healthTimer = null, heartbeatTimer = null;
  let failures = 0, active = options.active !== false, online = options.online !== false, disposed = false;
  // Connections in a row that timed out before any coin sent a price.
  let silentAttempts = 0;
  // The connection's own state; each coin's is derived from it.
  let connection = { kind: "paused", cause: null, reason: "", retryAt: null };
  // Coins that have sent a price on the current connection.
  let tickedNow = new Set();
  // Requests to an exchange are spaced out, here and for the coin list alike.
  let pacer = options.pacer;
  if (!pacer) {
    let store = options.attemptStore;
    if (store === undefined) { try { store = globalThis.sessionStorage; } catch (_) {} }
    pacer = createPacer({ now: clock.now, store });
  }

  function report(selection) {
    const market = selection.market;
    const kind = connection.kind === "live" && !tickedNow.has(market) ? "waiting" : connection.kind;
    onState({ kind, cause: connection.cause, reason: connection.reason, retryAt: connection.retryAt, selection,
      last: lasts.get(market) || null,
      tickerSuspect: !everTicked.has(market) && (silentAttempts >= 2 || unanswered.has(market)) });
  }
  // cause: a key of REASONS, "exchange-error", or null when nothing is wrong.
  function emit(kind, cause, retryAt, detail) {
    connection = { kind, cause: cause || null, reason: detail || (REASONS[cause] ? REASONS[cause]() : ""), retryAt: retryAt || null };
    selections.forEach(report);
  }
  function clearTimers() {
    if (retryTimer !== null) clock.clearTimeout(retryTimer);
    if (healthTimer !== null) clock.clearInterval(healthTimer);
    if (heartbeatTimer !== null) clock.clearInterval(heartbeatTimer);
    retryTimer = healthTimer = heartbeatTimer = null;
  }
  function disconnect() {
    generation++;
    clearTimers();
    tickedNow = new Set();
    const old = socket;
    socket = null;
    if (old) {
      old.onopen = old.onmessage = old.onerror = old.onclose = null;
      try { old.close(); } catch (_) {}
    }
  }
  function eligible() { return !disposed && active && online && selections.length > 0; }
  function rateWait() { return pacer.waitFor(currency); }
  function schedule(delay, cause) {
    if (!eligible()) { emit(!online ? "offline" : "paused", cause); return; }
    delay = Math.max(delay || 0, rateWait());
    if (delay === 0) { connect(); return; }
    const token = generation;
    emit("backoff", cause || "rate-wait", clock.now() + delay);
    retryTimer = clock.setTimeout(() => {
      retryTimer = null;
      if (token === generation && eligible()) connect();
    }, delay);
  }
  function fail(cause, minimumDelay) {
    disconnect();
    const backoff = Math.min(30000, 1000 * Math.pow(2, Math.min(failures++, 5)));
    schedule(Math.max(minimumDelay || 0, backoff + Math.floor(random() * backoff * 0.25)), cause);
  }
  async function decode(data) {
    if (typeof data === "string") return JSON.parse(data);
    if (data && typeof data.text === "function") return JSON.parse(await data.text());
    return JSON.parse(new TextDecoder().decode(data));
  }
  function connect() {
    if (!eligible()) return;
    if (rateWait() > 0) { schedule(0); return; }
    const exchange = EXCHANGES[currency], wanted = byMarket, markets = [...byMarket.keys()];
    const token = generation;
    const startedAt = clock.now();
    let firstTickAt = null;
    // Liveness is judged by when this device received something, never by
    // comparing the exchange's clock with ours. Exchange event times only
    // order ticks within one connection, coin by coin.
    let lastMessageAt = startedAt;
    const lastEventTime = new Map();
    pacer.mark(currency);
    emit("connecting");
    let ws;
    try {
      ws = new WS(exchange.url(markets));
      ws.binaryType = "arraybuffer";
    } catch (error) { fail("connect-failed"); return; }
    socket = ws;
    function isCurrent() { return token === generation && socket === ws && eligible(); }
    healthTimer = clock.setInterval(() => {
      if (!isCurrent()) return;
      const now = clock.now();
      if (firstTickAt === null && now - startedAt >= staleMs) {
        silentAttempts++;
        fail("timeout");
      } else if (firstTickAt !== null && now - lastMessageAt >= staleMs) {
        fail("stale");
      } else if (firstTickAt !== null && now - firstTickAt >= staleMs) {
        // The connection works but a coin has said nothing since: perhaps no
        // such market. It keeps its place; the status says to check it.
        for (const selection of selections) {
          const market = selection.market;
          if (!tickedNow.has(market) && !everTicked.has(market) && !unanswered.has(market)) { unanswered.add(market); report(selection); }
        }
      }
    }, 1000);
    ws.onopen = () => {
      if (!isCurrent()) return;
      emit("waiting");
      try {
        exchange.subscribe(markets, `${startedAt}-${token}`).forEach((frame) => { ws.send(frame); });
        if (exchange.heartbeat) ws.send(exchange.heartbeat);
      } catch (error) { fail("subscribe-failed"); return; }
      if (exchange.heartbeat) {
        heartbeatTimer = clock.setInterval(() => {
          if (isCurrent() && ws.readyState === WS.OPEN) {
            try { ws.send(exchange.heartbeat); } catch (_) { fail("heartbeat-failed"); }
          }
        }, exchange.heartbeatMs);
      }
    };
    ws.onmessage = async (event) => {
      if (!isCurrent()) return;
      try {
        const data = await decode(event.data);
        if (!isCurrent()) return; // Includes a Blob decoding across a switch.
        const message = exchange.read(data);
        if (!message) return;
        if (message.type === "error") {
          if (message.code === "TOO_MANY_REQUEST") { fail("rate-limited", 30000); return; }
          disconnect();
          emit("error", "exchange-error", null, m.reason_exchange_error({ code: message.code }));
          return;
        }
        if (message.type === "restart") { fail("restart"); return; }
        if (message.type === "alive") { lastMessageAt = clock.now(); return; }
        const selection = wanted.get(message.market);
        if (!selection) return;
        const price = message.price, change = message.change, eventTime = message.eventTime;
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change) ||
            !Number.isFinite(eventTime) || eventTime <= 0) return;
        if (eventTime < (lastEventTime.get(message.market) ?? -Infinity)) return;
        lastEventTime.set(message.market, eventTime);
        lastMessageAt = clock.now();
        if (firstTickAt === null) firstTickAt = lastMessageAt;
        const last = { price, change, eventTime, receivedAt: lastMessageAt, selection };
        lasts.set(message.market, last);
        tickedNow.add(message.market); everTicked.add(message.market); unanswered.delete(message.market);
        silentAttempts = 0; failures = 0;
        onTick(last);
        if (connection.kind !== "live") emit("live"); else report(selection);
      } catch (error) {
        // Corrupt payloads do not mark prices fresh. The watchdog will recover.
        if (isCurrent() && options.onError) options.onError(error);
      }
    };
    ws.onerror = () => { if (isCurrent()) fail("network"); };
    ws.onclose = () => { if (isCurrent()) fail("closed"); };
  }
  // tickers: one ticker or a list; the order is kept.
  function select(nextCurrency, tickers) {
    const list = [...new Set((Array.isArray(tickers) ? tickers : [tickers || "BTC"]).map((ticker) => String(ticker).toUpperCase()))];
    if (!Object.hasOwn(EXCHANGES, nextCurrency) || list.length === 0 || !list.every((ticker) => /^[A-Z0-9]{1,20}$/.test(ticker))) {
      throw new Error("Invalid market selection");
    }
    if (nextCurrency === currency && list.join() === selections.map((selection) => selection.ticker).join()) return;
    // The same coins in another order: nothing to ask the exchange, only the
    // order in which states are reported changes.
    if (nextCurrency === currency && [...list].sort().join() === selections.map((selection) => selection.ticker).sort().join()) {
      selections = list.map((ticker) => byMarket.get(describeMarket(currency, ticker).market));
      return;
    }
    disconnect();
    const next = list.map((ticker) => describeMarket(nextCurrency, ticker));
    const kept = new Set(nextCurrency === currency ? next.map((selection) => selection.market) : []);
    // Coins that stay keep their last price; anything else starts afresh.
    for (const market of [...lasts.keys()]) if (!kept.has(market)) lasts.delete(market);
    for (const set of [everTicked, unanswered]) for (const market of [...set]) if (!kept.has(market)) set.delete(market);
    currency = nextCurrency; selections = next; byMarket = new Map(next.map((selection) => [selection.market, selection]));
    failures = 0; silentAttempts = 0;
    schedule(0);
  }
  function setActive(value) {
    value = !!value;
    if (value === active || disposed) return;
    active = value; disconnect();
    if (active) schedule(0); else emit("paused", "hidden");
  }
  function setOnline(value) {
    value = !!value;
    if (value === online || disposed) return;
    online = value; disconnect();
    if (online) schedule(0); else emit("offline", "offline");
  }
  return {
    select, setActive, setOnline,
    // Whether the connection is delivering prices.
    get live() { return connection.kind === "live"; },
    // Whether it is waiting to try again (after a failure or an exchange
    // error), as opposed to working or already connecting.
    get stalled() { return connection.kind === "backoff" || connection.kind === "error"; },
    retry() { if (eligible()) { disconnect(); schedule(0); } },
    dispose() { disposed = true; disconnect(); },
  };
}

// The whole board: a list of { currency, ticker }, possibly mixing markets.
// Each market kind gets one connection carrying all its coins, so the board
// never holds more than one connection per exchange stream.
export function createBoardFeed(options) {
  options = options || {};
  const feeds = new Map();
  let active = options.active !== false, online = options.online !== false;
  return {
    select(assets) {
      const groups = new Map();
      for (const asset of assets) {
        if (!groups.has(asset.currency)) groups.set(asset.currency, []);
        groups.get(asset.currency).push(asset.ticker);
      }
      for (const [currency, feed] of feeds) if (!groups.has(currency)) { feed.dispose(); feeds.delete(currency); }
      for (const [currency, tickers] of groups) {
        let feed = feeds.get(currency);
        if (!feed) { feed = createMarketFeed({ ...options, active, online }); feeds.set(currency, feed); }
        feed.select(currency, tickers);
      }
    },
    setActive(value) { active = !!value; for (const feed of feeds.values()) feed.setActive(value); },
    setOnline(value) { online = !!value; for (const feed of feeds.values()) feed.setOnline(value); },
    // Only connections waiting to try again. One that works, or one that is
    // connecting right now, is left alone: closing it would spend one of
    // Upbit's requests for nothing and wait out the next ten seconds.
    retry() { for (const feed of feeds.values()) if (feed.stalled) feed.retry(); },
    dispose() { for (const feed of feeds.values()) feed.dispose(); feeds.clear(); },
  };
}
