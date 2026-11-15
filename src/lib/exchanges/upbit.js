// Upbit KRW market. https://docs.upbit.com/kr/reference/websocket-ticker
import { number } from "./number.js";

export const upbit = {
  // name is shown in settings (Korean); label and changeLabel on the board (English).
  name: "업비트",
  label: "UPBIT",
  // The change is against the previous day's close.
  changeLabel: "1D",
  // Browsers send Origin: Upbit limits these connection requests to one per 10 seconds.
  minConnectInterval: 10000,
  // Upbit only sends a ticker when a trade happens. After the first text PING
  // it sends {"status":"UP"} every 10 seconds, which shows the connection is
  // alive while the market is quiet. So: PING at open, then every 10 seconds.
  heartbeat: "PING",
  heartbeatMs: 10000,
  market(ticker) { return `KRW-${ticker}`; },
  // How the market is written for people.
  pair(ticker) { return `KRW-${ticker}`; },
  url() { return "wss://api.upbit.com/websocket/v1"; },
  // Frames to send once the socket is open.
  subscribe(market, id) {
    return [JSON.stringify([{ ticket: `coinboard-${id}` }, { type: "ticker", codes: [market] }, { format: "DEFAULT" }])];
  },
  // One decoded message -> { type: "tick" | "alive" | "error" | "restart" } or null to ignore.
  read(data, market) {
    if (data.error) return { type: "error", code: data.error.name };
    if (data.status === "UP") return { type: "alive" };
    if (data.type !== "ticker" || data.code !== market) return null;
    return { type: "tick", price: number(data.trade_price), change: number(data.signed_change_rate) * 100, eventTime: number(data.timestamp) };
  },
};
