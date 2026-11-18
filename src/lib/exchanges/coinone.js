// Coinone KRW market. https://docs.coinone.co.kr/reference/public-websocket-1
// Coinone's REST API does not answer web pages from other sites (no CORS), so
// there is no coin list to check against and no chart: prices only.
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

const frame = (request_type, market) => JSON.stringify({ request_type, channel: "TICKER", topic: { quote_currency: "KRW", target_currency: market } });
export const coinone = {
  get name() { return m.exchange_coinone(); },
  label: "COINONE",
  get choice() { return m.market_coinone_krw(); },
  get listName() { return m.list_coinone_krw(); },
  quote: "KRW",
  tag: "",
  changeLabel: "24H",
  minConnectInterval: 2000,
  // Coinone sends a ticker when a trade happens and answers PING with PONG.
  heartbeat: JSON.stringify({ request_type: "PING" }),
  heartbeatMs: 10000,
  market(ticker) { return ticker; },
  pair(ticker) { return `KRW-${ticker}`; },
  url() { return "wss://stream.coinone.co.kr"; },
  // One coin a request.
  subscribe(markets) { return markets.map((market) => frame("SUBSCRIBE", market)); },
  resubscribe(from, to) {
    return [
      ...from.filter((market) => !to.includes(market)).map((market) => frame("UNSUBSCRIBE", market)),
      ...coinone.subscribe(to.filter((market) => !from.includes(market))),
    ];
  },
  read(data) {
    if (!data || typeof data !== "object") return null;
    if (data.response_type === "PONG") return { type: "alive" };
    // An unknown coin is accepted, then refused with "Invalid Topic" that does
    // not say which coin: it is left waiting, the others carry on.
    if (data.response_type === "ERROR") return data.error_code === 160012 ? null : { type: "error", code: String(data.error_code || data.message || "UNKNOWN") };
    if (data.response_type !== "DATA" || data.channel !== "TICKER" || !data.data || typeof data.data.target_currency !== "string") return null;
    // "first": the price 24 hours ago.
    const ticker = data.data, last = number(ticker.last), first = number(ticker.first);
    return { type: "tick", market: ticker.target_currency, price: last, change: first > 0 ? (last - first) / first * 100 : NaN, eventTime: number(ticker.timestamp) };
  },
};
