// Price and change strings. Pure: no DOM, no settings.
var whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
var cents = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Coins worth less than 100 KRW or 1 USDT would round to zero with the fixed
// decimals above, so they show exactly four significant digits instead
// (a fixed count keeps the width from jumping between 0.25 and 0.2501).
var small = new Intl.NumberFormat("en-US", { minimumSignificantDigits: 4, maximumSignificantDigits: 4 });

// The digits and the currency code separately, so the code can be set smaller.
// The code always follows the digits, whatever the currency.
export function priceParts(currency, value) {
  if (currency === "KRW") return { digits: (value >= 100 ? whole : small).format(value), unit: "KRW" };
  return { digits: (value >= 1 ? cents : small).format(value), unit: "USDT" };
}
// "98,000,000 KRW", "70,000.10 USDT"
export function price(currency, value) {
  var parts = priceParts(currency, value);
  return parts.digits + " " + parts.unit;
}
// -1, 0 or 1 for the change as displayed, so +0.004% is neither up nor down.
export function direction(value) {
  var rounded = Number(value.toFixed(2));
  return rounded > 0 ? 1 : rounded < 0 ? -1 : 0;
}
// "▲ 1.23%" / "▼ 0.50%": the arrow carries the direction, so it reads from
// across a room and without relying on colour.
export function change(value) {
  var sign = direction(value);
  if (sign === 0) return "0.00%";
  return (sign > 0 ? "▲ " : "▼ ") + Math.abs(value).toFixed(2) + "%";
}
