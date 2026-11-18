// Bybit, USDT-quoted: spot and linear perpetuals. https://bybit-exchange.github.io/docs/v5/websocket/public/ticker
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

function bybitMarket(options) {
  // Perpetuals send a whole ticker first, then only the fields that changed:
  // the last 24-hour change is kept for a price that comes without one.
  const changes = new Map();
  const topic = (market) => `tickers.${market}`;
  const exchange = {
    get name() { return options.name(); },
    label: options.label,
    get choice() { return options.choice(); },
    get listName() { return options.listName(); },
    quote: "USDT",
    tag: options.tag,
    changeLabel: "24H",
    minConnectInterval: 1000,
    // Bybit drops a connection silent for 10 minutes; "ping" is answered at once.
    heartbeat: JSON.stringify({ op: "ping" }),
    heartbeatMs: 10000,
    market(ticker) { return `${ticker}USDT`; },
    pair(ticker) { return options.tag ? `${ticker}/USDT ${options.tag}` : `${ticker}/USDT`; },
    // The REST addresses: api.bytick.com is Bybit's second domain for the same API.
    listUrl: [`https://api.bybit.com/v5/market/instruments-info?category=${options.category}&limit=1000`, `https://api.bytick.com/v5/market/instruments-info?category=${options.category}&limit=1000`],
    listEntries(body) { return body && body.result && Array.isArray(body.result.list) ? body.result.list : null; },
    listedTicker(entry) {
      if (entry.status !== "Trading" || entry.quoteCoin !== "USDT" || typeof entry.baseCoin !== "string") return null;
      if (options.category === "linear" && entry.contractType !== "LinearPerpetual") return null;
      return entry.symbol === `${entry.baseCoin}USDT` ? entry.baseCoin : null;
    },
    // Past prices for the chart: [start, open, high, low, close, ...], newest first.
    candles(ticker, minutes, count) {
      const query = `/v5/market/kline?category=${options.category}&symbol=${exchange.market(ticker)}&interval=${minutes}&limit=${Math.min(count, 1000)}`;
      return {
        url: [`https://api.bybit.com${query}`, `https://api.bytick.com${query}`],
        parse: (body) => body && body.result && Array.isArray(body.result.list) ? body.result.list.map((candle) => [number(candle[0]), number(candle[4])]) : null,
      };
    },
    url() { return `wss://stream.bybit.com/v5/public/${options.category}`; },
    // One coin a request: Bybit refuses a whole request if one of its coins is not listed.
    subscribe(markets) { return markets.map((market) => JSON.stringify({ op: "subscribe", args: [topic(market)] })); },
    resubscribe(from, to) {
      const removed = from.filter((market) => !to.includes(market)), added = to.filter((market) => !from.includes(market));
      removed.forEach((market) => changes.delete(market));
      return [
        ...(removed.length ? [JSON.stringify({ op: "unsubscribe", args: removed.map(topic) })] : []),
        ...exchange.subscribe(added),
      ];
    },
    read(data) {
      if (!data || typeof data !== "object") return null;
      if (data.op === "ping" || data.op === "pong") return { type: "alive" };
      if (data.op === "subscribe" && data.success === false) {
        // Spot: "Invalid symbol :[tickers.X]"; perpetuals: "handler not found,topic:tickers.X".
        const missing = /tickers\.([A-Z0-9]+)/.exec(data.ret_msg || "");
        if (missing) return { type: "unlisted", market: missing[1] };
        return { type: "error", code: String(data.ret_msg || "UNKNOWN") };
      }
      if (typeof data.topic !== "string" || !data.topic.startsWith("tickers.") || !data.data || typeof data.data.symbol !== "string") return null;
      const ticker = data.data, market = ticker.symbol;
      // price24hPcnt is a fraction: 0.0123 is 1.23 %.
      if (ticker.price24hPcnt !== undefined) changes.set(market, number(ticker.price24hPcnt) * 100);
      // A change of other fields only (the order book, the funding rate).
      if (ticker.lastPrice === undefined) return { type: "alive" };
      return { type: "tick", market, price: number(ticker.lastPrice), change: changes.has(market) ? changes.get(market) : NaN, eventTime: number(data.ts) };
    },
  };
  return exchange;
}

export const bybit = bybitMarket({
  name: m.exchange_bybit, label: "BYBIT", choice: m.market_bybit_usdt, listName: m.list_bybit_usdt, tag: "", category: "spot",
});
export const bybitLinear = bybitMarket({
  name: m.exchange_bybit_futures, label: "BYBIT FUTURES", choice: m.market_bybit_perp, listName: m.list_bybit_perp, tag: "PERP", category: "linear",
});
