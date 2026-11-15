// Turns the feed's state into the words shown on the board and in settings.
import { price } from "./format.js";
import { m } from "../paraglide/messages.js";

export function describeState(state, now) {
  if (!state || !state.selection) {
    return { text: "", tone: "", level: "warn", unavailable: true, title: "WAITING", detail: "", canRetry: false };
  }
  let kind = state.kind, label;
  switch (kind) {
    case "live": label = m.status_live(); break;
    case "connecting": label = m.status_connecting(); break;
    case "waiting": label = m.status_waiting(); break;
    case "paused": label = m.status_paused(); break;
    case "offline": label = m.status_offline(); break;
    case "error": label = state.reason; break;
    default:
      label = m.status_retry({ reason: state.reason, seconds: Math.max(0, Math.ceil((state.retryAt - now) / 1000)) });
  }
  const problem = ["backoff", "error", "offline"].includes(kind);
  // The title is shown on the board, which is English only. Everything else
  // here is for the settings panel, in the reader's language.
  let title = kind === "live" ? "LIVE" : kind === "error" ? "ERROR" : kind === "offline" ? "OFFLINE" :
    kind === "backoff" && state.cause === "stale" ? "DELAYED" : "WAITING";
  if (kind !== "live" && state.last) title += " · LAST PRICE";
  // Offline and exchange errors already say what is wrong.
  if (state.tickerSuspect && ["backoff", "connecting", "waiting"].includes(kind)) title = "CHECK TICKER";
  let detail = "";
  if (kind !== "live") {
    detail = state.last ? m.status_last_price({ price: price(state.last.selection.quote, state.last.price), seconds: Math.max(0, Math.floor((now - state.last.receivedAt) / 1000)) }) : m.status_no_price();
    if (state.reason) detail += `\n${state.reason}`;
    if (state.tickerSuspect) detail += `\n${m.status_ticker_suspect()}`;
  }
  return {
    text: `${state.selection.exchange} · ${label}`,
    tone: kind === "live" ? "connected" : kind === "connecting" || kind === "waiting" ? "" : "error",
    unavailable: kind !== "live",
    // One of three colours for the status dot: fine, working on it, needs attention.
    level: kind === "live" ? "ok" : problem && kind !== "backoff" ? "bad" : "warn",
    title, detail, canRetry: kind === "error",
  };
}
