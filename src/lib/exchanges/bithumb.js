// Bithumb KRW market. Its WebSocket speaks Upbit's format (ticket, type, codes).
// https://apidocs.bithumb.com/reference/websocket-기본-정보
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

export const bithumb = {
  get name() { return m.exchange_bithumb(); },
  label: "BITHUMB",
  get choice() { return m.market_bithumb_krw(); },
  get listName() { return m.list_bithumb_krw(); },
  quote: "KRW",
  tag: "",
  // Against the previous day's close, as on Upbit.
  changeLabel: "1D",
  minConnectInterval: 2000,
  // Bithumb sends a ticker only when a trade happens, and has no keep-alive
  // answer. A subscription sent again is answered at once with every coin's
  // current ticker, so that is the heartbeat: every 10 seconds, the same coins.
  heartbeat(markets, id) { return bithumb.subscribe(markets, `beat-${id}`); },
  heartbeatAtOpen: false,
  heartbeatMs: 10000,
  market(ticker) { return `KRW-${ticker}`; },
  listUrl: "https://api.bithumb.com/v1/market/all",
  listedTicker(entry) { return typeof entry.market === "string" && entry.market.startsWith("KRW-") ? entry.market.slice(4) : null; },
  pair(ticker) { return `KRW-${ticker}`; },
  // Past prices for the chart: minute candles (1, 15, 60, 240), newest first.
  candles(ticker, minutes, count) {
    return {
      url: `https://api.bithumb.com/v1/candles/minutes/${minutes}?market=KRW-${ticker}&count=${Math.min(count, 200)}`,
      parse: (body) => Array.isArray(body) ? body.map((candle) => [Date.parse(`${candle.candle_date_time_utc}Z`), number(candle.trade_price)]) : null,
    };
  },
  url() { return "wss://ws-api.bithumb.com/websocket/v1"; },
  subscribe(markets, id) {
    return [JSON.stringify([{ ticket: `coinboard-${id}` }, { type: "ticker", codes: markets }, { format: "DEFAULT" }])];
  },
  // As on Upbit, a new subscription replaces the old one.
  resubscribe(from, to, id) { return bithumb.subscribe(to, id); },
  read(data) {
    if (data && data.error) return { type: "error", code: String(data.error.name || data.error.message || "UNKNOWN") };
    if (!data || data.type !== "ticker" || typeof data.code !== "string") return null;
    return { type: "tick", market: data.code, price: number(data.trade_price), change: number(data.signed_change_rate) * 100, eventTime: number(data.timestamp) };
  },
};
