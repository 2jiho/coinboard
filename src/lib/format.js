// Price and change strings. Pure: no DOM, no settings.
var whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
var cents = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Prices under 100 KRW or 1 USDT would round to zero with fixed decimals, so
// they show exactly four significant digits instead (a fixed count keeps the
// width from jumping between 0.25 and 0.2501).
var small = new Intl.NumberFormat("en-US", { minimumSignificantDigits: 4, maximumSignificantDigits: 4 });
var MAN = 10000;

// Won: from 1000만 up, the Korean way, rounded to 만 ("1억 2340만", "9800만").
// That keeps at least four figures. Below 1000만 every digit is shown, because
// rounding to 만 there would throw away a visible share of the price.
function wonPieces(value) {
  if (value >= 1000 * MAN) {
    var man = Math.round(value / MAN), eok = Math.floor(man / MAN), rest = man % MAN, pieces = [];
    if (eok > 0) pieces.push({ number: String(eok), mark: "억" });
    if (rest > 0) pieces.push({ number: String(rest), mark: "만" });
    return pieces;
  }
  return [{ number: (value >= 100 ? whole : small).format(value), mark: "" }];
}
// USDT: whole dollars from 100 up, cents from 1 to under 100.
function usdtPieces(value) {
  // 99.996 would print as "100.00"; let it be a whole "100" instead.
  var format = value >= 99.995 ? whole : value >= 1 ? cents : small;
  return [{ number: format.format(value), mark: "" }];
}
// The pieces to draw: each number with its 억/만 mark (if any), and the
// currency code, which is shown apart from the price.
export function priceParts(currency, value) {
  return currency === "KRW" ? { pieces: wonPieces(value), unit: "KRW" } : { pieces: usdtPieces(value), unit: "USDT" };
}
// "1억 2340만 KRW", "4,512,000 KRW", "70,000 USDT", "12.30 USDT"
export function price(currency, value) {
  var parts = priceParts(currency, value);
  return parts.pieces.map(function (piece) { return piece.number + piece.mark; }).join(" ") + " " + parts.unit;
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
