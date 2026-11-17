/**
 * Market-wide data shared by the scheduled data job (scripts/), the Worker API (server/) and
 * the pulse page. Short keys keep the JSON small: these files cover ~1,000 stocks.
 */
import type { MarketId, Quote } from './types.ts';
import type { Bias, PatternId } from './patterns.ts';

/** Where the scheduled job publishes its files (assets of the "data" GitHub release). */
export const DATA_BASE_URL = 'https://github.com/AishvaryaRamesh08/StockMarketView-v2/releases/download/data/';

/** One index constituent (NIFTY 500 or S&P 500). */
export interface UniverseEntry {
  /** Yahoo symbol, e.g. RELIANCE.NS, BRK-B. */
  s: string;
  /** Company name. */
  n: string;
  /** Sector (NSE's industry group for India, GICS sector for the US). */
  sec: string;
  /** Finer industry (Yahoo's industry for India, GICS sub-industry for the US), used to find peers. */
  ind?: string;
  /** Market capitalisation in the stock's currency, if known. */
  cap?: number;
}

export interface Universe {
  generatedAt: string;
  markets: Record<MarketId, UniverseEntry[]>;
}

export interface PatternFeedHit {
  s: string;
  n: string;
  sec: string;
  p: PatternId;
  b: Bias;
  /** Close of the pattern candle and its % change on the day. */
  c: number;
  chg: number;
  /** Volume on the pattern candle relative to the 20-day average (1.0 = average). */
  vr: number | null;
  /** RSI(14) at the pattern candle. */
  rsi: number | null;
}

export interface PatternFeed {
  market: MarketId;
  /** Exchange-local date of the scanned session, e.g. "2026-11-16". */
  session: string;
  generatedAt: string;
  scanned: number;
  hits: PatternFeedHit[];
}

/** One stock in the live market pulse. */
export interface PulseStock {
  s: string;
  n: string;
  sec: string;
  /** Last price, % change today, volume, turnover (price × volume). */
  p: number;
  chg: number;
  v: number;
  t: number;
  cap?: number;
}

export interface Pulse {
  market: MarketId;
  /** Unix seconds of the most recent trade across the market. */
  asOf: number;
  indices: Quote[];
  stocks: PulseStock[];
}

export const PULSE_INDICES: Record<MarketId, string[]> = {
  IN: ['^NSEI', '^BSESN', '^NSEBANK', '^CNXIT'],
  US: ['^GSPC', '^IXIC', '^DJI', '^RUT'],
};

export function isMarketId(v: unknown): v is MarketId {
  return v === 'IN' || v === 'US';
}
