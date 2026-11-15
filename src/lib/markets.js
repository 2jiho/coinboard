// Which coins each exchange lists, so a typed ticker can be completed and
// checked before the board tries to show it. One request per exchange, made
// only when someone opens the field for typing a ticker; never repeated on a
// timer. It takes turns with the price connection (see pace.js). If the list cannot be had, the answer is null and any ticker is let
// through, as before.
import { EXCHANGES } from "./exchanges/index.js";

const TICKER = /^[A-Z0-9]{1,20}$/;

export function createMarketList(options) {
  const fetch = options.fetch;
  // Optional: the pacer shared with the price connection, and how to wait.
  const pacer = options.pacer;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const loads = new Map();

  async function request(currency) {
    const exchange = EXCHANGES[currency];
    try {
      if (pacer) {
        // Take a turn: wait until the exchange may be sent something, and
        // again if the price connection used that turn in the meantime.
        for (let wait = pacer.waitFor(currency); wait > 0; wait = pacer.waitFor(currency)) await sleep(wait);
        pacer.mark(currency);
      }
      const response = await fetch(exchange.listUrl);
      if (!response.ok) return null;
      const body = await response.json();
      if (!Array.isArray(body)) return null;
      const tickers = new Set();
      for (const entry of body) {
        const ticker = entry && exchange.listedTicker(entry);
        if (ticker && TICKER.test(ticker)) tickers.add(ticker);
      }
      return tickers.size ? [...tickers].sort() : null;
    } catch (error) {
      return null;
    }
  }
  return {
    // Resolves to a sorted list of tickers, or null if it could not be had.
    load(currency) {
      if (!loads.has(currency)) {
        const attempt = request(currency);
        loads.set(currency, attempt);
        // A failure is not remembered: the next opening of the field asks again.
        attempt.then((tickers) => { if (!tickers && loads.get(currency) === attempt) loads.delete(currency); });
      }
      return loads.get(currency);
    },
  };
}
