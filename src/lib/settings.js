// Load, validate and persist kiosk settings. Knows nothing about the DOM.
import { EXCHANGES } from "./exchanges/index.js";

const KEY = "coinboard-settings";
// The project was called btc-price-kiosk. Same origin, so old settings are still readable.
const OLD_KEY = "btc-kiosk-settings";
const TICKER = /^[A-Z0-9]{1,20}$/;
export function normalizeTicker(text) {
  if (typeof text !== "string") return null;
  const ticker = text.trim().toUpperCase();
  return TICKER.test(ticker) ? ticker : null;
}
export function createSettings(storage) {
  const settings = { ticker: "BTC", currency: "KRW", brightness: 100, burnIn: true, palette: "green-red" };
  try {
    const saved = JSON.parse(storage.getItem(KEY) || storage.getItem(OLD_KEY));
    if (saved && typeof saved === "object") {
      const ticker = normalizeTicker(saved.ticker);
      if (ticker) settings.ticker = ticker;
      // "currency" holds the market: KRW (Upbit), USDT (Binance) or USDT-PERP (Binance futures).
      if (typeof saved.currency === "string" && Object.hasOwn(EXCHANGES, saved.currency)) settings.currency = saved.currency;
      // On unless it was explicitly switched off.
      settings.burnIn = saved.burnIn !== false;
      // Up/down colours: green and red, or the Korean red and blue.
      if (saved.palette === "red-blue") settings.palette = "red-blue";
      const brightness = Number(saved.brightness);
      if (Number.isFinite(brightness) && brightness >= 10 && brightness <= 100) settings.brightness = brightness;
    }
    // Remove the obsolete converted-rate storage from previous installations.
    storage.removeItem("btc-last-exchange-rate");
  } catch (error) { /* Unreadable storage: run on defaults. */ }
  function get() {
    return { ticker: settings.ticker, currency: settings.currency, brightness: settings.brightness, burnIn: settings.burnIn, palette: settings.palette };
  }
  // Callers pass validated values; a failed write still applies for this run.
  function update(patch) {
    ["ticker", "currency", "brightness", "burnIn", "palette"].forEach((key) => {
      if (patch[key] !== undefined) settings[key] = patch[key];
    });
    try { storage.setItem(KEY, JSON.stringify(settings)); storage.removeItem(OLD_KEY); return { saved: true }; }
    catch (error) { return { saved: false }; }
  }
  return { get, update, normalizeTicker };
}
