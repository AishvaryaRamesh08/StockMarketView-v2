/** One OHLCV bar. `t` is the bar's start time in Unix seconds (UTC). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  /** IANA zone of the exchange, e.g. Asia/Kolkata. */
  timezone: string;
  type: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  high52: number | null;
  low52: number | null;
  /** Unix seconds of the last trade the provider reported. */
  marketTime: number | null;
  priceHint: number;
}

export interface ChartResponse {
  quote: Quote;
  range: string;
  interval: string;
  candles: Candle[];
}

export interface QuotesResponse {
  quotes: Quote[];
}

export interface ApiError {
  error: string;
}

export type MarketId = 'IN' | 'US';

/** Compact search-index row: [symbol, name, exchange, kind]. kind: s=stock, e=ETF, i=index. */
export type SymbolRow = [string, string, string, 's' | 'e' | 'i'];
