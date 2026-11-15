// Upbit KRW market. https://docs.upbit.com/kr/reference/websocket-ticker
import { number } from "./number.js";

export const upbit = {
  name: "업비트",
  changeLabel: "전일 대비",
  // Browsers send Origin: Upbit limits these connection requests to one per 10 seconds.
  minConnectInterval: 10000,
  // Upbit only sends a ticker when a trade happens. After the first text PING
  // it sends {"status":"UP"} every 10 seconds, which shows the connection is
  // alive while the market is quiet. So: PING at open, then every 10 seconds.
  heartbeat: "PING",
  heartbeatMs: 10000,
  market: function (ticker) { return "KRW-" + ticker; },
  url: function () { return "wss://api.upbit.com/websocket/v1"; },
  // Frames to send once the socket is open.
  subscribe: function (market, id) {
    return [JSON.stringify([{ ticket: "coinboard-" + id }, { type: "ticker", codes: [market] }, { format: "DEFAULT" }])];
  },
  // One decoded message -> { type: "tick" | "alive" | "error" | "restart" } or null to ignore.
  read: function (data, market) {
    if (data.error) return { type: "error", code: data.error.name };
    if (data.status === "UP") return { type: "alive" };
    if (data.type !== "ticker" || data.code !== market) return null;
    // high_price/low_price: the day's range since 09:00 KST, the same day the change is measured over.
    return { type: "tick", price: number(data.trade_price), change: number(data.signed_change_rate) * 100, eventTime: number(data.timestamp),
      high: number(data.high_price), low: number(data.low_price) };
  },
};
