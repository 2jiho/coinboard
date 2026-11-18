// OKX, USDT-quoted: spot and perpetual swaps. One public WebSocket for both.
// https://www.okx.com/docs-v5/en/#public-data-websocket-tickers-channel
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

function okxMarket(options) {
  const exchange = {
    get name() { return options.name(); },
    label: options.label,
    get choice() { return options.choice(); },
    get listName() { return options.listName(); },
    quote: "USDT",
    tag: options.tag,
    changeLabel: "24H",
    // OKX allows 3 connection requests a second from one address.
    minConnectInterval: 1000,
    // Port 443: the documented 8443 is closed on many networks. Then the EEA
    // address, for a region where the main one is not served.
    hosts: ["wss://ws.okx.com/ws/v5/public", "wss://wseea.okx.com/ws/v5/public"],
    // OKX closes a connection silent for 30 seconds: "ping" is answered "pong".
    heartbeat: "ping",
    heartbeatAtOpen: false,
    heartbeatMs: 20000,
    market(ticker) { return `${ticker}-USDT${options.suffix}`; },
    pair(ticker) { return options.tag ? `${ticker}/USDT ${options.tag}` : `${ticker}/USDT`; },
    // Each instrument: spot ones are "<ticker>-USDT"; swaps "<ticker>-USDT-SWAP", settled in USDT.
    listUrl: [`https://www.okx.com/api/v5/public/instruments?instType=${options.instType}`, `https://my.okx.com/api/v5/public/instruments?instType=${options.instType}`],
    listEntries(body) { return body && Array.isArray(body.data) ? body.data : null; },
    listedTicker(entry) {
      if (typeof entry.instId !== "string" || entry.state !== "live" || !entry.instId.endsWith(`-USDT${options.suffix}`)) return null;
      return entry.instId.slice(0, entry.instId.length - `-USDT${options.suffix}`.length);
    },
    // Past prices for the chart: candles (ts, o, h, l, close), newest first, wrapped in { data }.
    candles(ticker, minutes, count) {
      const bar = { 1: "1m", 15: "15m", 60: "1H", 240: "4H" }[minutes];
      const query = `/api/v5/market/candles?instId=${exchange.market(ticker)}&bar=${bar}&limit=${Math.min(count, 300)}`;
      return {
        url: [`https://www.okx.com${query}`, `https://my.okx.com${query}`],
        parse: (body) => body && Array.isArray(body.data) ? body.data.map((candle) => [number(candle[0]), number(candle[4])]) : null,
      };
    },
    url(markets, host = exchange.hosts[0]) { return host; },
    subscribe(markets) {
      return markets.length ? [JSON.stringify({ op: "subscribe", args: markets.map((instId) => ({ channel: "tickers", instId })) })] : [];
    },
    resubscribe(from, to) {
      const removed = from.filter((market) => !to.includes(market)), added = to.filter((market) => !from.includes(market));
      return [
        ...(removed.length ? [JSON.stringify({ op: "unsubscribe", args: removed.map((instId) => ({ channel: "tickers", instId })) })] : []),
        ...exchange.subscribe(added),
      ];
    },
    read(data) {
      if (data === "pong") return { type: "alive" };
      if (!data || typeof data !== "object") return null;
      if (data.event === "error") {
        // 60018: no such instrument. That coin alone is refused; the connection carries on.
        const missing = /instId:(\S+) doesn't exist/.exec(data.msg || "");
        if (missing) return { type: "unlisted", market: missing[1].replace(/[,.]$/, "") };
        return { type: "error", code: String(data.code || "UNKNOWN") };
      }
      if (data.event) return null; // subscribe / unsubscribe answers
      const ticker = Array.isArray(data.data) && data.data[0];
      if (!data.arg || data.arg.channel !== "tickers" || !ticker || typeof ticker.instId !== "string") return null;
      // The change over a rolling 24 hours, from the price 24 hours ago.
      const last = number(ticker.last), open = number(ticker.open24h);
      return { type: "tick", market: ticker.instId, price: last, change: open > 0 ? (last - open) / open * 100 : NaN, eventTime: number(ticker.ts) };
    },
  };
  return exchange;
}

export const okx = okxMarket({
  name: m.exchange_okx, label: "OKX", choice: m.market_okx_usdt, listName: m.list_okx_usdt, tag: "", suffix: "", instType: "SPOT",
});
export const okxSwap = okxMarket({
  name: m.exchange_okx_futures, label: "OKX FUTURES", choice: m.market_okx_perp, listName: m.list_okx_perp, tag: "PERP", suffix: "-SWAP", instType: "SWAP",
});
