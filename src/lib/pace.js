// Spaces out everything sent to an exchange from this browser. Upbit accepts
// one browser request per ten seconds, and that covers both opening the price
// connection and asking for its coin list, so the two take turns here.
import { EXCHANGES } from "./exchanges/index.js";

const KEY = "coinboard-connect-";

export function createPacer(options) {
  const now = options.now, store = options.store;
  const last = {};
  // A reload must not jump the queue: remember the last request for a minute.
  for (const currency of Object.keys(EXCHANGES)) {
    try {
      const value = Number(store.getItem(KEY + currency));
      if (value > 0 && value <= now() && value > now() - 60000) last[currency] = value;
    } catch (_) { /* no store, or one that cannot be read */ }
  }
  return {
    // Milliseconds until this exchange may be sent something.
    waitFor(currency) {
      if (last[currency] === undefined) return 0;
      return Math.max(0, last[currency] + EXCHANGES[currency].minConnectInterval - now());
    },
    // Call just before sending.
    mark(currency) {
      last[currency] = now();
      try { store.setItem(KEY + currency, String(last[currency])); } catch (_) { /* not remembered across reloads */ }
    },
  };
}
