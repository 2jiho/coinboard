// Binance, USDT-quoted: the spot market and the perpetual futures. Both speak
// the same ticker message; they differ in address and in name.
// Spot:    https://developers.binance.com/en/docs/products/spot/web-socket-streams
// Futures: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams
import { number } from "./number.js";

function binanceMarket(options) {
  return {
    // name and choice are shown in settings (Korean); label, pair, tag and
    // changeLabel on the board (English).
    name: options.name,
    label: options.label,
    choice: options.choice,
    listName: options.listName,
    quote: "USDT",
    // Shown after the currency on the board, and in the tab title.
    tag: options.tag,
    // The change is over a rolling 24 hours.
    changeLabel: "24H",
    // At least 2 seconds between connection attempts (limit: 300 per 5 minutes).
    minConnectInterval: 2000,
    // Protocol PING/PONG is handled by the browser and is invisible here, so
    // there is no heartbeat: liveness is judged by tickers alone.
    heartbeat: null,
    heartbeatMs: 0,
    market(ticker) { return `${ticker}USDT`; },
    pair(ticker) { return options.tag ? `${ticker}/USDT ${options.tag}` : `${ticker}/USDT`; },
    // A price for every symbol traded; the ones wanted are exactly "<ticker>USDT"
    // (futures also list dated contracts such as "BTCUSDT_270326").
    listUrl: options.listUrl,
    listedTicker(entry) { return typeof entry.symbol === "string" && entry.symbol.endsWith("USDT") ? entry.symbol.slice(0, -4) : null; },
    url(market) { return `${options.stream}/ws/${market.toLowerCase()}@ticker`; },
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
}

export const binance = binanceMarket({
  name: "바이낸스", label: "BINANCE", choice: "USDT · 바이낸스", listName: "바이낸스 USDT", tag: "",
  stream: "wss://stream.binance.com:443", listUrl: "https://api.binance.com/api/v3/ticker/price",
});

// USDⓈ-margined perpetual contracts: the last traded price of e.g. BTCUSDT perpetual.
export const binanceFutures = binanceMarket({
  name: "바이낸스 선물", label: "BINANCE FUTURES", choice: "USDT 무기한 · 바이낸스", listName: "바이낸스 USDT 무기한 선물", tag: "PERP",
  // Futures streams are routed by path since 2026-04-23: tickers are regular
  // market data, under /market. Without the path no ticker arrives.
  stream: "wss://fstream.binance.com/market", listUrl: "https://fapi.binance.com/fapi/v1/ticker/price",
});
