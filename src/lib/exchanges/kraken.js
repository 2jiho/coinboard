// Kraken, US dollars. WebSocket v2: https://docs.kraken.com/api/docs/websocket-v2/ticker
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

// The coin list still uses Kraken's old names for two coins; prices use the new.
const RENAMED = { XBT: "BTC", XDG: "DOGE" };
const params = (symbol) => ({ channel: "ticker", symbol });
export const kraken = {
  get name() { return m.exchange_kraken(); },
  label: "KRAKEN",
  get choice() { return m.market_kraken_usd(); },
  get listName() { return m.list_kraken_usd(); },
  quote: "USD",
  tag: "",
  changeLabel: "24H",
  minConnectInterval: 1000,
  // Once subscribed, Kraken sends a heartbeat every second: nothing to send.
  heartbeat: null,
  heartbeatMs: 0,
  market(ticker) { return `${ticker}/USD`; },
  pair(ticker) { return `${ticker}/USD`; },
  // Every pair, keyed by Kraken's own name.
  listUrl: "https://api.kraken.com/0/public/AssetPairs",
  listEntries(body) { return body && body.result && typeof body.result === "object" ? Object.values(body.result) : null; },
  listedTicker(entry) {
    if (entry.status !== "online" || typeof entry.wsname !== "string" || !entry.wsname.endsWith("/USD")) return null;
    const base = entry.wsname.slice(0, -4);
    return RENAMED[base] || base;
  },
  // Past prices for the chart: [time (s), open, high, low, close, ...], oldest
  // first, the latest 720 of the size asked for.
  candles(ticker, minutes) {
    const pair = kraken.market(ticker);
    return {
      url: `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${minutes}`,
      parse: (body) => {
        const candles = body && body.result && body.result[pair];
        return Array.isArray(candles) ? candles.map((candle) => [number(candle[0]) * 1000, number(candle[4])]) : null;
      },
    };
  },
  url() { return "wss://ws.kraken.com/v2"; },
  subscribe(markets) { return markets.length ? [JSON.stringify({ method: "subscribe", params: params(markets) })] : []; },
  resubscribe(from, to) {
    const removed = from.filter((market) => !to.includes(market)), added = to.filter((market) => !from.includes(market));
    return [
      ...(removed.length ? [JSON.stringify({ method: "unsubscribe", params: params(removed) })] : []),
      ...kraken.subscribe(added),
    ];
  },
  read(data) {
    if (!data || typeof data !== "object") return null;
    if (data.channel === "heartbeat" || data.method === "pong") return { type: "alive" };
    if (data.method === "subscribe" && data.success === false) {
      // "Currency pair not supported NOPE/USD": that coin alone; the others are subscribed.
      if (typeof data.symbol === "string") return { type: "unlisted", market: data.symbol };
      return { type: "error", code: String(data.error || "UNKNOWN") };
    }
    if (data.channel !== "ticker" || !Array.isArray(data.data) || !data.data[0] || typeof data.data[0].symbol !== "string") return null;
    const ticker = data.data[0];
    return { type: "tick", market: ticker.symbol, price: number(ticker.last), change: number(ticker.change_pct), eventTime: Date.parse(ticker.timestamp) };
  },
};
