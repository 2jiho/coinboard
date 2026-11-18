// Coinbase Exchange, US dollars. https://docs.cdp.coinbase.com/exchange/websocket-feed/channels
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

const CHANNELS = ["ticker", "heartbeat"];
export const coinbase = {
  get name() { return m.exchange_coinbase(); },
  label: "COINBASE",
  get choice() { return m.market_coinbase_usd(); },
  get listName() { return m.list_coinbase_usd(); },
  quote: "USD",
  tag: "",
  changeLabel: "24H",
  minConnectInterval: 1000,
  // The heartbeat channel says every second that each coin's feed is alive,
  // so nothing needs to be sent.
  heartbeat: null,
  heartbeatMs: 0,
  market(ticker) { return `${ticker}-USD`; },
  pair(ticker) { return `${ticker}/USD`; },
  listUrl: "https://api.exchange.coinbase.com/products",
  listedTicker(entry) { return entry.quote_currency === "USD" && entry.status === "online" && typeof entry.base_currency === "string" ? entry.base_currency : null; },
  // Past prices for the chart: candles [time (s), low, high, open, close], newest
  // first, up to 300. There are no 4-hour ones: 6 hours stand in.
  candles(ticker, minutes) {
    const seconds = minutes === 240 ? 21600 : minutes * 60;
    return {
      url: `https://api.exchange.coinbase.com/products/${ticker}-USD/candles?granularity=${seconds}`,
      parse: (body) => Array.isArray(body) ? body.map((candle) => [number(candle[0]) * 1000, number(candle[4])]) : null,
    };
  },
  url() { return "wss://ws-feed.exchange.coinbase.com"; },
  subscribe(markets) { return markets.length ? [JSON.stringify({ type: "subscribe", product_ids: markets, channels: CHANNELS })] : []; },
  resubscribe(from, to) {
    const removed = from.filter((market) => !to.includes(market)), added = to.filter((market) => !from.includes(market));
    return [
      ...(removed.length ? [JSON.stringify({ type: "unsubscribe", product_ids: removed, channels: CHANNELS })] : []),
      ...coinbase.subscribe(added),
    ];
  },
  read(data) {
    if (!data || typeof data !== "object") return null;
    if (data.type === "heartbeat") return { type: "alive" };
    if (data.type === "error") {
      // "<product> is not a valid product": that coin alone; the others are subscribed.
      const missing = /^(\S+) is not a valid product/.exec(data.reason || "");
      if (missing) return { type: "unlisted", market: missing[1] };
      return { type: "error", code: String(data.reason || data.message || "UNKNOWN") };
    }
    if (data.type !== "ticker" || typeof data.product_id !== "string") return null;
    const price = number(data.price), open = number(data.open_24h);
    return { type: "tick", market: data.product_id, price, change: open > 0 ? (price - open) / open * 100 : NaN, eventTime: Date.parse(data.time) };
  },
};
