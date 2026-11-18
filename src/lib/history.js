// Past prices for the small line chart beside the change: the exchange's own
// candles (closing prices) over the chosen period. Knows nothing of the DOM.
//
// Each period is drawn from candles of one size: enough points to show its
// shape, few enough to ask for at once. Between requests the board keeps the
// chart current itself (extend, below), so candles are asked for rarely: once
// a candle's time has passed, and no more often than every ten minutes.
//
// Requests take turns with the price connection (pace.js): Upbit refuses a
// browser's second request within ten seconds, candles and sockets alike.
import { EXCHANGES } from "./exchanges/index.js";

export const PERIODS = {
  "15m": { ms: 15 * 60e3, bar: 1 },
  "1h": { ms: 60 * 60e3, bar: 1 },
  "1d": { ms: 24 * 60 * 60e3, bar: 15 },
  "1w": { ms: 7 * 24 * 60 * 60e3, bar: 60 },
  "1M": { ms: 30 * 24 * 60 * 60e3, bar: 240 },
};
export const CHART_CHOICES = ["off", ...Object.keys(PERIODS)];
const MIN_REFRESH = 10 * 60e3, FAILED_RETRY = 60e3, TIMEOUT = 10e3;

// A live price into a chart: the latest candle's close follows it, and a new
// candle starts once a candle's time has passed. Points older than the period go.
export function extend(points, time, price, period) {
  const spec = PERIODS[period];
  if (!spec || !points || points.length === 0 || !Number.isFinite(price)) return points;
  const bar = spec.bar * 60e3, last = points.at(-1);
  if (time < last[0] || (time - last[0] < bar && last[1] === price)) return points;
  const next = time - last[0] >= bar ? [...points, [time, price]] : [...points.slice(0, -1), [last[0], price]];
  return next.filter(([at]) => at >= time - spec.ms - bar);
}

export function createHistory({ fetch, now = Date.now, pacer = null, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  // key -> { at, promise }; per exchange, the request in progress (one at a time).
  const cache = new Map(), turns = new Map();
  async function ask(currency, url) {
    // Take a turn with the exchange's other requests, the price connection included.
    if (pacer) {
      for (let wait = pacer.waitFor(currency); wait > 0; wait = pacer.waitFor(currency)) await sleep(wait);
      pacer.mark(currency);
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    return response.ok ? response.json() : null;
  }
  async function request(currency, ticker, period) {
    const exchange = EXCHANGES[currency], spec = PERIODS[period];
    if (!exchange?.candles || !spec) return null;
    const count = Math.ceil(spec.ms / (spec.bar * 60e3)) + 1;
    const { url, parse } = exchange.candles(ticker, spec.bar, count);
    for (const address of [url].flat()) {
      try {
        const body = await ask(currency, address);
        if (body === null) continue;
        const points = parse(body);
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
    load(currency, ticker, period) {
      const key = `${currency}:${ticker}:${period}`;
      const fresh = Math.max(MIN_REFRESH, (PERIODS[period]?.bar || 1) * 60e3);
      const hit = cache.get(key);
      if (hit && now() - hit.at < (hit.failed ? FAILED_RETRY : fresh)) return hit.promise;
      // One request at a time per exchange: the next waits for the one before.
      const before = turns.get(currency) || Promise.resolve();
      const promise = before.then(() => request(currency, ticker, period));
      turns.set(currency, promise.catch(() => null));
      const entry = { at: now(), promise, failed: false };
      cache.set(key, entry);
      // Freshness counts from the answer; a failure is asked again a minute on.
      promise.then((points) => { entry.at = now(); entry.failed = !points; });
      return promise;
    },
  };
}
