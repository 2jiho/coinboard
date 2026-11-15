// Binance USDT market. https://developers.binance.com/en/docs/products/spot/web-socket-streams
import { number } from "./number.js";

export const binance = {
  name: "바이낸스",
  label: "BINANCE",
  // The change is over a rolling 24 hours.
  changeLabel: "24H",
  // At least 2 seconds between connection attempts (limit: 300 per 5 minutes).
  minConnectInterval: 2000,
  // Protocol PING/PONG is handled by the browser and is invisible here, so
  // there is no heartbeat: liveness is judged by tickers alone.
  heartbeat: null,
  heartbeatMs: 0,
  market(ticker) { return `${ticker}USDT`; },
  pair(ticker) { return `${ticker}/USDT`; },
  // A price for every symbol Binance trades; the USDT ones are "<ticker>USDT".
  listUrl: "https://api.binance.com/api/v3/ticker/price",
  listedTicker(entry) { return typeof entry.symbol === "string" && entry.symbol.endsWith("USDT") ? entry.symbol.slice(0, -4) : null; },
  url(market) { return `wss://stream.binance.com:443/ws/${market.toLowerCase()}@ticker`; },
  // The stream is chosen by the URL; nothing to send.
  subscribe() { return []; },
  read(data, market) {
    // Errors arrive bare ({ code, msg }) or wrapped ({ error: { code, msg } }).
    if (data.error) return { type: "error", code: String(data.error.code !== undefined ? data.error.code : data.error.name || "UNKNOWN") };
    if (data.code !== undefined && data.msg) return { type: "error", code: String(data.code) };
    if (data.e === "serverShutdown") return { type: "restart" };
    if (data.e !== "24hrTicker" || data.s !== market) return null;
    return { type: "tick", price: number(data.c), change: number(data.P), eventTime: number(data.E) };
  },
};
