// The markets the board can show. The key is what settings store as "currency"
// (it began as just the two currencies, hence the name); keys once stored stay.
import { upbit } from "./upbit.js";
import { bithumb } from "./bithumb.js";
import { binance, binanceFutures } from "./binance.js";
import { okx, okxSwap } from "./okx.js";
import { coinbase } from "./coinbase.js";
import { bybit, bybitLinear } from "./bybit.js";
import { kraken } from "./kraken.js";
import { coinone } from "./coinone.js";

export const EXCHANGES = {
  KRW: upbit, "BITHUMB-KRW": bithumb, "COINONE-KRW": coinone,
  USDT: binance, "USDT-PERP": binanceFutures, "OKX-USDT": okx, "OKX-USDT-PERP": okxSwap,
  "BYBIT-USDT": bybit, "BYBIT-USDT-PERP": bybitLinear,
  "COINBASE-USD": coinbase, "KRAKEN-USD": kraken,
};
// How settings list them: by the currency prices are in.
export const MARKET_GROUPS = [
  { quote: "KRW", keys: ["KRW", "BITHUMB-KRW", "COINONE-KRW"] },
  { quote: "USDT", keys: ["USDT", "USDT-PERP", "OKX-USDT", "OKX-USDT-PERP", "BYBIT-USDT", "BYBIT-USDT-PERP"] },
  { quote: "USD", keys: ["COINBASE-USD", "KRAKEN-USD"] },
];
