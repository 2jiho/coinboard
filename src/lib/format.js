// Price and change strings. Pure: no DOM, no settings.
//
// One idea throughout: always show at least four figures, and no more decimals
// than that needs. A price then takes about the same room and shows its
// movement whatever its size.
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
// Exactly four significant digits: 152.3, 98.77, 2.346, 0.6234, 0.00001234.
// (A fixed count keeps the width from jumping between 0.25 and 0.2501.)
const four = new Intl.NumberFormat("en-US", { minimumSignificantDigits: 4, maximumSignificantDigits: 4 });
const MAN = 10000;

// Won, the Korean way:
//   1억 and up        "1억 2340만"   rounded to 만
//   1000만 to 1억      "8934만"
//   100만 to 1000만    "451.2만"     one decimal of 만
//   100 to 100만       "152,300"     written out; Upbit quotes whole won here
//   under 100          "12.34"       four significant digits
function wonPieces(value) {
  // Round first, then choose the range, so 999.96만 is "1000만" and not "1000.0만".
  const tenths = Math.round(value / (MAN / 10));
  if (tenths >= 10000) {
    const man = Math.round(value / MAN), eok = Math.floor(man / MAN), rest = man % MAN, pieces = [];
    if (eok > 0) pieces.push({ number: String(eok), mark: "억" });
    if (rest > 0) pieces.push({ number: String(rest), mark: "만" });
    return pieces;
  }
  if (tenths >= 1000) return [{ number: (tenths / 10).toFixed(1), mark: "만" }];
  return [{ number: (value >= 100 ? whole : four).format(value), mark: "" }];
}
// USDT: whole dollars from 1,000 up ("70,123"), four significant digits below
// ("152.3", "98.77", "2.346", "0.6234"). 999.96 rounds to "1,000" either way.
function usdtPieces(value) {
  return [{ number: (value >= 1000 ? whole : four).format(value), mark: "" }];
}
// The pieces to draw: each number with its 억/만 mark (if any), and the
// currency code, which is shown apart from the price.
export function priceParts(currency, value) {
  return currency === "KRW" ? { pieces: wonPieces(value), unit: "KRW" } : { pieces: usdtPieces(value), unit: "USDT" };
}
// "1억 2340만 KRW", "451.2만 KRW", "70,123 USDT", "152.3 USDT"
export function price(currency, value) {
  const parts = priceParts(currency, value);
  return `${parts.pieces.map((piece) => { return piece.number + piece.mark; }).join(" ")  } ${parts.unit}`;
}
// -1, 0 or 1 for the change as displayed, so +0.004% is neither up nor down.
export function direction(value) {
  const rounded = Number(value.toFixed(2));
  return rounded > 0 ? 1 : rounded < 0 ? -1 : 0;
}
// "▲ 1.23%" / "▼ 0.50%": the arrow carries the direction, so it reads from
// across a room and without relying on colour.
export function change(value) {
  const sign = direction(value);
  if (sign === 0) return "0.00%";
  return `${(sign > 0 ? "▲ " : "▼ ") + Math.abs(value).toFixed(2)}%`;
}
// For the browser tab: "8996만 | BTC | Coinboard", or "BTC | Coinboard" before a price
// arrives. The price comes first, since a narrow tab shows only the start.
export function tabTitle(ticker, currency, tick) {
  if (!tick) return `${ticker} | Coinboard`;
  const amount = priceParts(currency, tick.price).pieces.map((piece) => piece.number + piece.mark).join(" ");
  return `${amount} | ${ticker} | Coinboard`;
}
