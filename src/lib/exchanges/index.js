// The markets the board can show. The key is what settings store as "currency"
// (it began as just the two currencies, hence the name).
import { upbit } from "./upbit.js";
import { binance, binanceFutures } from "./binance.js";

export const EXCHANGES = { KRW: upbit, USDT: binance, "USDT-PERP": binanceFutures };
