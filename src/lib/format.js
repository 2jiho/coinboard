// Price and change strings. Pure: no DOM, no settings.
var krw = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
var usdt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Coins worth less than ₩100 or 1 USDT would round to zero with the fixed
// decimals above, so they show exactly four significant digits instead
// (a fixed count keeps the width from jumping between 0.25 and 0.2501).
var smallKrw = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", minimumSignificantDigits: 4, maximumSignificantDigits: 4 });
var smallUsdt = new Intl.NumberFormat("en-US", { minimumSignificantDigits: 4, maximumSignificantDigits: 4 });
export function price(currency, value) {
  if (currency === "KRW") return (value >= 100 ? krw : smallKrw).format(value);
  return (value >= 1 ? usdt : smallUsdt).format(value) + " USDT";
}
// -1, 0 or 1 for the change as displayed, so +0.004% is neither up nor down.
export function direction(value) {
  var rounded = Number(value.toFixed(2));
  return rounded > 0 ? 1 : rounded < 0 ? -1 : 0;
}
export function change(value) {
  var sign = direction(value);
  return (sign > 0 ? "+" : "") + (sign === 0 ? "0.00" : value.toFixed(2)) + "%";
}
