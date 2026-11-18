// Past prices for the small line chart beside the change: the exchange's own
// candles (closing prices) over the chosen period. Knows nothing of the DOM.
//
// Each period is drawn from candles of one size: enough points to show its
// shape, few enough to ask for at once. The live price is added by the board.
import { EXCHANGES } from "./exchanges/index.js";

export const PERIODS = {
  "15m": { ms: 15 * 60e3, bar: 1 },
  "1h": { ms: 60 * 60e3, bar: 1 },
  "1d": { ms: 24 * 60 * 60e3, bar: 15 },
  "1w": { ms: 7 * 24 * 60 * 60e3, bar: 60 },
  "1M": { ms: 30 * 24 * 60 * 60e3, bar: 240 },
};
export const CHART_CHOICES = ["off", ...Object.keys(PERIODS)];

export function createHistory({ fetch, now = Date.now }) {
  // key -> { at, promise }: one request per coin and period while it is fresh.
  const cache = new Map();
  async function request(currency, ticker, period) {
    const exchange = EXCHANGES[currency], spec = PERIODS[period];
    if (!exchange?.candles || !spec) return null;
    const count = Math.ceil(spec.ms / (spec.bar * 60e3)) + 1;
    const { url, parse } = exchange.candles(ticker, spec.bar, count);
    for (const address of [url].flat()) {
      try {
        const response = await fetch(address);
        if (!response.ok) continue;
        const points = parse(await response.json());
        if (!Array.isArray(points)) return null;
        // Oldest first, within the period, and only real numbers.
        const since = now() - spec.ms;
        const kept = points.filter(([time, price]) => Number.isFinite(time) && time >= since - spec.bar * 60e3 && Number.isFinite(price) && price > 0)
          .sort((a, b) => a[0] - b[0]);
        return kept.length >= 2 ? kept : null;
      } catch (_) { /* the next address */ }
    }
    return null;
  }
  return {
    // Resolves to [[time, price], ...] oldest first, or null if none could be had.
    // Asked again once a candle's time has passed (at least a minute).
    load(currency, ticker, period) {
      const key = `${currency}:${ticker}:${period}`;
      const fresh = Math.max(60e3, (PERIODS[period]?.bar || 1) * 60e3);
      const hit = cache.get(key);
      if (hit && now() - hit.at < fresh) return hit.promise;
      const promise = request(currency, ticker, period);
      cache.set(key, { at: now(), promise });
      promise.then((points) => { if (!points && cache.get(key)?.promise === promise) cache.delete(key); });
      return promise;
    },
  };
}
