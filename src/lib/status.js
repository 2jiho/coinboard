// Turns the feed's state into the words shown on the board and in settings.
import { price } from "./format.js";

export function describeState(state, now) {
  if (!state || !state.selection) {
    return { text: "", tone: "", level: "warn", unavailable: true, title: "WAITING", detail: "", canRetry: false };
  }
  let kind = state.kind, label;
  switch (kind) {
    case "live": label = "실시간 연결됨"; break;
    case "connecting": label = "연결 중…"; break;
    case "waiting": label = "새 시세 수신 대기…"; break;
    case "paused": label = "백그라운드 대기"; break;
    case "offline": label = "오프라인"; break;
    case "error": label = state.reason; break;
    default:
      label = `${state.reason} · 재연결 ${Math.max(0, Math.ceil((state.retryAt - now) / 1000))}초 후`;
  }
  const problem = ["backoff", "error", "offline"].includes(kind);
  // The title is shown on the board, which is English only. Everything else
  // here is for the settings panel.
  let title = kind === "live" ? "LIVE" : kind === "error" ? "ERROR" : kind === "offline" ? "OFFLINE" :
    kind === "backoff" && state.cause === "stale" ? "DELAYED" : "WAITING";
  if (kind !== "live" && state.last) title += " · LAST PRICE";
  // Offline and exchange errors already say what is wrong.
  if (state.tickerSuspect && ["backoff", "connecting", "waiting"].includes(kind)) title = "CHECK TICKER";
  let detail = "";
  if (kind !== "live") {
    detail = state.last ? `마지막 시세: ${price(state.last.selection.currency, state.last.price)} · ${Math.max(0, Math.floor((now - state.last.receivedAt) / 1000))}초 전` : "아직 수신한 시세가 없습니다.";
    if (state.reason) detail += `\n${state.reason}`;
    if (state.tickerSuspect) detail += "\n지원하지 않는 티커일 수 있습니다";
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
