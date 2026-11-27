// Load, validate and persist kiosk settings. Knows nothing about the DOM.
import { EXCHANGES } from "./exchanges/index.js";
import { CHART_CHOICES } from "./history.js";

const KEY = "coinboard-settings";
const TICKER = /^[A-Z0-9]{1,20}$/;
// A board shows one coin large, or several in a grid. The grid takes any
// number; this cap only keeps the type readable and the list in settings short.
export const MAX_ASSETS = 20;
// The most cells per row that can be chosen by hand.
export const MAX_COLUMNS = 6;
export function normalizeTicker(text) {
  if (typeof text !== "string") return null;
  const ticker = text.trim().toUpperCase();
  return TICKER.test(ticker) ? ticker : null;
}
// One thing on the board: a coin in a market. "currency" holds the market:
// KRW (Upbit), USDT (Binance) or USDT-PERP (Binance futures).
// What a new board shows: Bitcoin on Binance (USDT spot).
export const DEFAULT_ASSET = Object.freeze({ currency: "USDT", ticker: "BTC" });
export function sameAsset(a, b) { return a.currency === b.currency && a.ticker === b.ticker; }
function readAsset(saved) {
  if (!saved || typeof saved !== "object") return null;
  const ticker = normalizeTicker(saved.ticker) || "BTC";
  const currency = typeof saved.currency === "string" && Object.hasOwn(EXCHANGES, saved.currency) ? saved.currency : DEFAULT_ASSET.currency;
  return { currency, ticker };
}
// At least one asset, at most MAX_ASSETS, none twice.
function readAssets(list) {
  const assets = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const asset = readAsset(entry);
    if (asset && !assets.some((other) => sameAsset(other, asset)) && assets.length < MAX_ASSETS) assets.push(asset);
  }
  return assets;
}
// A new board's settings.
// columns: cells per row in the grid; 0 lets the board choose (see PriceBoard).
// chart: the period of the chart behind the board ("off" for none).
// clock: the time, centred at the top of the board.
const defaults = () => ({ assets: [{ ...DEFAULT_ASSET }], columns: 0, brightness: 100, burnIn: true, palette: "green-red", chart: "1d", clock: true });
export function createSettings(storage) {
  const settings = defaults();
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (saved && typeof saved === "object") {
      // Settings saved before the grid hold one coin as { ticker, currency }.
      const assets = Array.isArray(saved.assets) ? readAssets(saved.assets) : [readAsset(saved)];
      if (assets.length) settings.assets = assets;
      if (Number.isInteger(saved.columns) && saved.columns >= 0 && saved.columns <= MAX_COLUMNS) settings.columns = saved.columns;
      // On unless it was explicitly switched off.
      settings.burnIn = saved.burnIn !== false;
      settings.clock = saved.clock !== false;
      // Up/down colours: green and red, or the Korean red and blue.
      if (saved.palette === "red-blue") settings.palette = "red-blue";
      if (CHART_CHOICES.includes(saved.chart)) settings.chart = saved.chart;
      const brightness = Number(saved.brightness);
      if (Number.isFinite(brightness) && brightness >= 10 && brightness <= 100) settings.brightness = brightness;
    }
  } catch (error) { /* Unreadable storage: run on defaults. */ }
  function get() {
    return { assets: settings.assets.map((asset) => ({ ...asset })), columns: settings.columns, brightness: settings.brightness, burnIn: settings.burnIn, palette: settings.palette, chart: settings.chart, clock: settings.clock };
  }
  // Callers pass validated values; a failed write still applies for this run.
  function update(patch) {
    if (patch.assets !== undefined) settings.assets = patch.assets.map((asset) => ({ currency: asset.currency, ticker: asset.ticker }));
    ["columns", "brightness", "burnIn", "palette", "chart", "clock"].forEach((key) => {
      if (patch[key] !== undefined) settings[key] = patch[key];
    });
    try { storage.setItem(KEY, JSON.stringify(settings)); return { saved: true }; }
    catch (error) { return { saved: false }; }
  }
  // Back to a new board: the defaults, and nothing saved, so the next start
  // reads a new board's defaults too. A failed removal still applies for this run.
  function reset() {
    Object.assign(settings, defaults());
    try { storage.removeItem(KEY); return { saved: true }; }
    catch (error) { return { saved: false }; }
  }
  return { get, update, reset, normalizeTicker };
}
