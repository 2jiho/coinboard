// Load, validate and persist kiosk settings. Knows nothing about the DOM.
var KEY = "coinboard-settings";
// The project was called btc-price-kiosk. Same origin, so old settings are still readable.
var OLD_KEY = "btc-kiosk-settings";
var TICKER = /^[A-Z0-9]{1,20}$/;
export function normalizeTicker(text) {
  if (typeof text !== "string") return null;
  var ticker = text.trim().toUpperCase();
  return TICKER.test(ticker) ? ticker : null;
}
export function createSettings(storage) {
  var settings = { ticker: "BTC", currency: "KRW", debug: false, brightness: 100, burnIn: true, range: false };
  try {
    var saved = JSON.parse(storage.getItem(KEY) || storage.getItem(OLD_KEY));
    if (saved && typeof saved === "object") {
      var ticker = normalizeTicker(saved.ticker);
      if (ticker) settings.ticker = ticker;
      if (["KRW", "USDT"].includes(saved.currency)) settings.currency = saved.currency;
      settings.debug = saved.debug === true;
      // On unless it was explicitly switched off.
      settings.burnIn = saved.burnIn !== false;
      // Off unless it was explicitly switched on.
      settings.range = saved.range === true;
      var brightness = Number(saved.brightness);
      if (Number.isFinite(brightness) && brightness >= 10 && brightness <= 100) settings.brightness = brightness;
    }
    // Remove the obsolete converted-rate storage from previous installations.
    storage.removeItem("btc-last-exchange-rate");
  } catch (error) { /* Unreadable storage: run on defaults. */ }
  function get() {
    return { ticker: settings.ticker, currency: settings.currency, debug: settings.debug, brightness: settings.brightness, burnIn: settings.burnIn, range: settings.range };
  }
  // Callers pass validated values; a failed write still applies for this run.
  function update(patch) {
    ["ticker", "currency", "debug", "brightness", "burnIn", "range"].forEach(function (key) {
      if (patch[key] !== undefined) settings[key] = patch[key];
    });
    try { storage.setItem(KEY, JSON.stringify(settings)); storage.removeItem(OLD_KEY); return { saved: true }; }
    catch (error) { return { saved: false }; }
  }
  return { get: get, update: update, normalizeTicker: normalizeTicker };
}
