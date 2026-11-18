// Binance, USDT-quoted: the spot market and the perpetual futures. Both speak
// the same ticker message; they differ in address and in name.
// Spot:    https://developers.binance.com/en/docs/products/spot/web-socket-streams
// Futures: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

function binanceMarket(options) {
  return {
    // name, choice and listName are shown in settings, in the reader's
    // language (message functions); label, pair, tag and changeLabel on the
    // board (English).
    get name() { return options.name(); },
    label: options.label,
    get choice() { return options.choice(); },
    get listName() { return options.listName(); },
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
    // The streams are chosen by the URL; nothing to send. One market is a raw
    // stream; several are one combined stream, whose messages come wrapped as
    // { stream, data }.
    // The addresses to try in turn (the feed moves on when one says nothing).
    hosts: options.hosts,
    url(markets, host = options.hosts[0]) {
      const streams = markets.map((market) => `${market.toLowerCase()}@ticker`);
      return streams.length === 1 ? `${host}/ws/${streams[0]}` : `${host}/stream?streams=${streams.join("/")}`;
    },
    subscribe() { return []; },
    // Other coins on the open connection: unsubscribe the ones dropped and
    // subscribe the new ones, whatever the URL first asked for. A raw stream
    // that gains coins keeps its unwrapped messages; read() takes either.
    // Answers are { result: null, id }, or an error read below.
    resubscribe(from, to, id) {
      const stream = (market) => `${market.toLowerCase()}@ticker`;
      const removed = from.filter((market) => !to.includes(market)).map(stream);
      const added = to.filter((market) => !from.includes(market)).map(stream);
      return [
        ...(removed.length ? [JSON.stringify({ method: "UNSUBSCRIBE", params: removed, id: id * 2 })] : []),
        ...(added.length ? [JSON.stringify({ method: "SUBSCRIBE", params: added, id: id * 2 + 1 })] : []),
      ];
    },
    // A tick names its market; the feed drops markets it did not ask for.
    read(data) {
      if (data && typeof data.stream === "string" && data.data && typeof data.data === "object") data = data.data;
      // Errors arrive bare ({ code, msg }) or wrapped ({ error: { code, msg } }).
      if (data.error) return { type: "error", code: String(data.error.code !== undefined ? data.error.code : data.error.name || "UNKNOWN") };
      if (data.code !== undefined && data.msg) return { type: "error", code: String(data.code) };
      if (data.e === "serverShutdown") return { type: "restart" };
      if (data.e !== "24hrTicker" || typeof data.s !== "string") return null;
      return { type: "tick", market: data.s, price: number(data.c), change: number(data.P), eventTime: number(data.E) };
    },
  };
}

// Spot market data comes from Binance's market-data-only hosts
// (data-stream / data-api .binance.vision): the same streams and prices,
// also reachable where binance.com itself is restricted.
export const binance = binanceMarket({
  name: m.exchange_binance, label: "BINANCE", choice: m.market_binance_usdt, listName: m.list_binance_usdt, tag: "",
  // Then binance.com itself, should the market-data host ever be out of reach.
  hosts: ["wss://data-stream.binance.vision", "wss://stream.binance.com:443"],
  listUrl: ["https://data-api.binance.vision/api/v3/ticker/price", "https://api.binance.com/api/v3/ticker/price"],
});

// USDⓈ-margined perpetual contracts: the last traded price of e.g. BTCUSDT perpetual.
export const binanceFutures = binanceMarket({
  name: m.exchange_binance_futures, label: "BINANCE FUTURES", choice: m.market_binance_perp, listName: m.list_binance_perp, tag: "PERP",
  // Futures streams are routed by path since 2026-04-23: tickers are regular
  // market data, under /market. Without the path no ticker arrives.
  hosts: ["wss://fstream.binance.com/market"], listUrl: "https://fapi.binance.com/fapi/v1/ticker/price",
});
