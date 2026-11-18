// The markets the board can show. The key is what settings store as "currency"
// (it began as just the two currencies, hence the name); keys once stored stay.
import { upbit } from "./upbit.js";
import { bithumb } from "./bithumb.js";
import { binance, binanceFutures } from "./binance.js";
import { okx, okxSwap } from "./okx.js";
import { coinbase } from "./coinbase.js";

export const EXCHANGES = {
  KRW: upbit, "BITHUMB-KRW": bithumb,
  USDT: binance, "USDT-PERP": binanceFutures, "OKX-USDT": okx, "OKX-USDT-PERP": okxSwap,
  "COINBASE-USD": coinbase,
};
// How settings list them: by the currency prices are in.
export const MARKET_GROUPS = [
  { quote: "KRW", keys: ["KRW", "BITHUMB-KRW"] },
  { quote: "USDT", keys: ["USDT", "USDT-PERP", "OKX-USDT", "OKX-USDT-PERP"] },
  { quote: "USD", keys: ["COINBASE-USD"] },
];
