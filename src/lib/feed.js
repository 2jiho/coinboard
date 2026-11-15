// Public market data only. No keys, price polling, or currency conversion.
// What is specific to an exchange lives in ./exchanges; this file owns the
// connection: when to connect, when to give up, when a price counts as live.
import { upbit } from "./exchanges/upbit.js";
import { binance } from "./exchanges/binance.js";

const EXCHANGES = { KRW: upbit, USDT: binance };

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
  let selection = null, socket = null, generation = 0, last = null;
  let retryTimer = null, healthTimer = null, heartbeatTimer = null;
  let failures = 0, active = options.active !== false, online = options.online !== false, disposed = false;
  // Connections in a row that timed out before this selection ever sent a price.
  let silentAttempts = 0, everTicked = false;
  const lastAttempt = { KRW: -Infinity, USDT: -Infinity };
  let store = options.attemptStore;
  if (store === undefined) { try { store = globalThis.sessionStorage; } catch (_) {} }
  if (store) {
    ["KRW", "USDT"].forEach((currency) => {
      try {
        const value = Number(store.getItem(`coinboard-connect-${  currency}`));
        if (value > 0 && value <= clock.now() && value > clock.now() - 60000) lastAttempt[currency] = value;
      } catch (_) {}
    });
  }

  function describe(currency, ticker) {
    return { currency, ticker,
      exchange: EXCHANGES[currency].name,
      market: EXCHANGES[currency].market(ticker),
      changeLabel: EXCHANGES[currency].changeLabel,
    };
  }
  function emit(kind, reason, retryAt) {
    onState({ kind, reason: reason || "", retryAt: retryAt || null, selection, last,
      tickerSuspect: !everTicked && silentAttempts >= 2 });
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
    const old = socket;
    socket = null;
    if (old) {
      old.onopen = old.onmessage = old.onerror = old.onclose = null;
      try { old.close(); } catch (_) {}
    }
  }
  function eligible() { return !disposed && active && online && !!selection; }
  function rateWait() {
    const minimum = EXCHANGES[selection.currency].minConnectInterval;
    return Math.max(0, lastAttempt[selection.currency] + minimum - clock.now());
  }
  function schedule(delay, reason) {
    if (!eligible()) { emit(!online ? "offline" : "paused", reason); return; }
    delay = Math.max(delay || 0, rateWait());
    if (delay === 0) { connect(); return; }
    const token = generation;
    emit("backoff", reason || "연결 요청 간격 대기", clock.now() + delay);
    retryTimer = clock.setTimeout(() => {
      retryTimer = null;
      if (token === generation && eligible()) connect();
    }, delay);
  }
  function fail(reason, minimumDelay) {
    disconnect();
    const backoff = Math.min(30000, 1000 * Math.pow(2, Math.min(failures++, 5)));
    schedule(Math.max(minimumDelay || 0, backoff + Math.floor(random() * backoff * 0.25)), reason);
  }
  async function decode(data) {
    if (typeof data === "string") return JSON.parse(data);
    if (data && typeof data.text === "function") return JSON.parse(await data.text());
    return JSON.parse(new TextDecoder().decode(data));
  }
  function connect() {
    if (!eligible()) return;
    if (rateWait() > 0) { schedule(0); return; }
    const current = selection, exchange = EXCHANGES[current.currency];
    const token = generation;
    let startedAt = clock.now(), gotTick = false;
    // Liveness is judged by when this device received something, never by
    // comparing the exchange's clock with ours. Exchange event times only
    // order ticks within one connection.
    let lastMessageAt = startedAt, lastEventTime = -Infinity;
    lastAttempt[current.currency] = startedAt;
    if (store) {
      try { store.setItem(`coinboard-connect-${  current.currency}`, String(startedAt)); } catch (_) {}
    }
    emit("connecting");
    let connection;
    try {
      connection = new WS(exchange.url(current.market));
      connection.binaryType = "arraybuffer";
    } catch (error) { fail(`연결 생성 실패: ${  error.name}`); return; }
    socket = connection;
    function isCurrent() { return token === generation && socket === connection && eligible(); }
    healthTimer = clock.setInterval(() => {
      if (!isCurrent()) return;
      if (!gotTick && clock.now() - startedAt >= staleMs) {
        silentAttempts++;
        fail("시세 수신 시간 초과");
      } else if (gotTick && clock.now() - lastMessageAt >= staleMs) {
        fail("시세 업데이트 지연");
      }
    }, 1000);
    connection.onopen = () => {
      if (!isCurrent()) return;
      emit("waiting");
      try {
        exchange.subscribe(current.market, `${startedAt  }-${  token}`).forEach((frame) => { connection.send(frame); });
        if (exchange.heartbeat) connection.send(exchange.heartbeat);
      } catch (error) { fail("구독 요청 실패"); return; }
      if (exchange.heartbeat) {
        heartbeatTimer = clock.setInterval(() => {
          if (isCurrent() && connection.readyState === WS.OPEN) {
            try { connection.send(exchange.heartbeat); } catch (_) { fail("연결 유지 요청 실패"); }
          }
        }, exchange.heartbeatMs);
      }
    };
    connection.onmessage = async (event) => {
      if (!isCurrent()) return;
      try {
        const data = await decode(event.data);
        if (!isCurrent()) return; // Includes a Blob decoding across a switch.
        const message = exchange.read(data, current.market);
        if (!message) return;
        if (message.type === "error") {
          if (message.code === "TOO_MANY_REQUEST") { fail("요청 한도 초과", 30000); return; }
          disconnect();
          emit("error", `거래소 오류: ${  message.code  } · 지원하는 티커를 확인하세요`);
          return;
        }
        if (message.type === "restart") { fail("거래소 연결 재시작"); return; }
        if (message.type === "alive") { lastMessageAt = clock.now(); return; }
        const price = message.price, change = message.change, eventTime = message.eventTime;
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change) ||
            !Number.isFinite(eventTime) || eventTime <= 0) return;
        if (eventTime < lastEventTime) return;
        lastEventTime = eventTime;
        lastMessageAt = clock.now();
        last = { price, change, eventTime, receivedAt: lastMessageAt, selection: current };
        gotTick = everTicked = true; silentAttempts = 0;
        onTick(last);
        failures = 0;
        emit("live");
      } catch (error) {
        // Corrupt payloads do not mark prices fresh. The watchdog will recover.
        if (isCurrent() && options.onError) options.onError(error);
      }
    };
    connection.onerror = () => { if (isCurrent()) fail("네트워크 연결 오류"); };
    connection.onclose = () => { if (isCurrent()) fail("거래소 연결 끊김"); };
  }
  function select(currency, ticker) {
    ticker = (ticker || "BTC").toUpperCase();
    if (!["KRW", "USDT"].includes(currency) || !/^[A-Z0-9]{1,20}$/.test(ticker)) throw new Error("Invalid market selection");
    if (selection && selection.currency === currency && selection.ticker === ticker) return;
    disconnect();
    selection = describe(currency, ticker); last = null; failures = 0;
    silentAttempts = 0; everTicked = false;
    schedule(0);
  }
  function setActive(value) {
    value = !!value;
    if (value === active || disposed) return;
    active = value; disconnect();
    if (active) schedule(0); else emit("paused", "앱 복귀 시 새 시세를 확인합니다");
  }
  function setOnline(value) {
    value = !!value;
    if (value === online || disposed) return;
    online = value; disconnect();
    if (online) schedule(0); else emit("offline", "네트워크 연결을 확인하세요");
  }
  return {
    select, setActive, setOnline,
    retry () { if (eligible()) { disconnect(); schedule(0); } },
    dispose () { disposed = true; disconnect(); },
  };
}
