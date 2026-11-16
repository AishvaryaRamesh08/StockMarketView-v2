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
  /** Today's intraday closes (5-minute), only on /api/quotes, for watchlist sparklines. */
  spark?: number[];
}

/** A dividend or split, at Unix seconds `t`. */
export interface CorporateEvent {
  t: number;
  kind: 'dividend' | 'split';
  /** Dividend amount per share, or split ratio such as "2:1". */
  value: string;
}

export interface ChartResponse {
  quote: Quote;
  range: string;
  interval: string;
  candles: Candle[];
  events: CorporateEvent[];
}

export interface QuotesResponse {
  quotes: Quote[];
}

/** Slow-changing company data. Every field is optional: the UI hides what is missing. */
export interface Profile {
  symbol: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  pe?: number;
  /** Symbols Yahoo considers related, used for "similar stocks" in Phase 3. */
  related?: string[];
}

export interface ApiError {
  error: string;
}

export type MarketId = 'IN' | 'US';

/** Compact search-index row: [symbol, name, exchange, kind]. kind: s=stock, e=ETF, i=index. */
export type SymbolRow = [string, string, string, 's' | 'e' | 'i'];
