// Binance USDT market. https://developers.binance.com/en/docs/products/spot/web-socket-streams
import { number } from "./number.js";

export const binance = {
  name: "바이낸스",
  changeLabel: "24h",
  // At least 2 seconds between connection attempts (limit: 300 per 5 minutes).
  minConnectInterval: 2000,
  // Protocol PING/PONG is handled by the browser and is invisible here, so
  // there is no heartbeat: liveness is judged by tickers alone.
  heartbeat: null,
  heartbeatMs: 0,
  market: function (ticker) { return ticker + "USDT"; },
  url: function (market) { return "wss://stream.binance.com:443/ws/" + market.toLowerCase() + "@ticker"; },
  // The stream is chosen by the URL; nothing to send.
  subscribe: function () { return []; },
  read: function (data, market) {
    // Errors arrive bare ({ code, msg }) or wrapped ({ error: { code, msg } }).
    if (data.error) return { type: "error", code: String(data.error.code !== undefined ? data.error.code : data.error.name || "UNKNOWN") };
    if (data.code !== undefined && data.msg) return { type: "error", code: String(data.code) };
    if (data.e === "serverShutdown") return { type: "restart" };
    if (data.e !== "24hrTicker" || data.s !== market) return null;
    return { type: "tick", price: number(data.c), change: number(data.P), eventTime: number(data.E) };
  },
};
