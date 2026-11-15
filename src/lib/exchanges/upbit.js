// Upbit KRW market. https://docs.upbit.com/kr/reference/websocket-ticker
import { number } from "./number.js";
import { m } from "../../paraglide/messages.js";

export const upbit = {
  // name, choice and listName are shown in settings, in the reader's language;
  // label and changeLabel on the board (English).
  get name() { return m.exchange_upbit(); },
  label: "UPBIT",
  get choice() { return m.market_upbit_krw(); },
  get listName() { return m.list_upbit_krw(); },
  quote: "KRW",
  tag: "",
  // The change is against the previous day's close.
  changeLabel: "1D",
  // Browsers send Origin: Upbit limits these connection requests to one per 10
  // seconds. Exactly 10 is too close: with a little network delay Upbit sees
  // less than 10, refuses (429), and counts the refusal too, so the next try
  // ten seconds on is refused again. Hence a second of margin.
  minConnectInterval: 11000,
  // Upbit only sends a ticker when a trade happens. After the first text PING
  // it sends {"status":"UP"} every 10 seconds, which shows the connection is
  // alive while the market is quiet. So: PING at open, then every 10 seconds.
  heartbeat: "PING",
  heartbeatMs: 10000,
  market(ticker) { return `KRW-${ticker}`; },
  // Every market Upbit lists; the KRW ones are "KRW-<ticker>".
  listUrl: "https://api.upbit.com/v1/market/all",
  listedTicker(entry) { return typeof entry.market === "string" && entry.market.startsWith("KRW-") ? entry.market.slice(4) : null; },
  // How the market is written for people.
  pair(ticker) { return `KRW-${ticker}`; },
  // One connection carries every KRW market on the board.
  url() { return "wss://api.upbit.com/websocket/v1"; },
  // Frames to send once the socket is open: one subscription for all the markets.
  subscribe(markets, id) {
    return [JSON.stringify([{ ticket: `coinboard-${id}` }, { type: "ticker", codes: markets }, { format: "DEFAULT" }])];
  },
  // One decoded message -> { type: "tick" | "alive" | "error" | "restart" } or null to ignore.
  // A tick names its market; the feed drops markets it did not ask for.
  read(data) {
    if (data.error) return { type: "error", code: data.error.name };
    if (data.status === "UP") return { type: "alive" };
    if (data.type !== "ticker" || typeof data.code !== "string") return null;
    return { type: "tick", market: data.code, price: number(data.trade_price), change: number(data.signed_change_rate) * 100, eventTime: number(data.timestamp) };
  },
};
