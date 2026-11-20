/**
 * Everything that knows about Yahoo Finance: hosts, URL shapes, response types and the fixes
 * for its quirks. The live API (server/api.ts) and the data scripts (scripts/) both go through
 * this module, so swapping the data provider means replacing this file.
 *
 * Known quirks handled here:
 *  - Batch (spark) calls accept at most 20 symbols.
 *  - Gaps are padded with null OHLC values.
 *  - The current day's DAILY candle comes back empty for NSE/BSE stocks.
 *  - chartPreviousClose is the close before the requested range, not before today.
 */
import { sessionFromIntraday } from '../src/lib/candles.ts';
import type { Candle } from '../src/lib/types.ts';

export const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
export const YAHOO_MAX_BATCH = 20;

const enc = encodeURIComponent;

/** URL paths (append to a host). */
export const yahooPath = {
  chart: (symbol: string, range: string, interval: string, events = false) =>
    `/v8/finance/chart/${enc(symbol)}?range=${range}&interval=${interval}&includePrePost=false${events ? '&events=div%2Csplits' : ''}`,
  /** Up to YAHOO_MAX_BATCH symbols in one call. */
  spark: (symbols: string[], range: string, interval: string) => `/v7/finance/spark?symbols=${symbols.map(enc).join(',')}&range=${range}&interval=${interval}`,
  search: (symbol: string) => `/v1/finance/search?q=${enc(symbol)}&quotesCount=5&newsCount=0&listsCount=0`,
  /** Free-text ticker search, for listings newer than the bundled search index. */
  searchQuotes: (query: string) => `/v1/finance/search?q=${enc(query)}&quotesCount=12&newsCount=0&listsCount=0`,
  timeseries: (symbol: string, types: string[], fromSec: number, toSec: number) =>
    `/ws/fundamentals-timeseries/v1/finance/timeseries/${enc(symbol)}?type=${types.join(',')}&period1=${fromSec}&period2=${toSec}`,
  related: (symbol: string) => `/v6/finance/recommendationsbysymbol/${enc(symbol)}`,
};

export interface YahooMeta {
  symbol: string;
  /** Exchange's UTC offset in seconds (IST = 19800). */
  gmtoffset?: number;
  currency?: string;
  longName?: string;
  shortName?: string;
  fullExchangeName?: string;
  exchangeTimezoneName?: string;
  instrumentType?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  priceHint?: number;
}

export interface YahooChartResult {
  meta: YahooMeta;
  timestamp?: number[];
  events?: {
    dividends?: Record<string, { amount: number; date: number }>;
    splits?: Record<string, { date: number; numerator: number; denominator: number }>;
  };
  indicators: { quote: Array<{ open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }> };
}

export interface YahooChartResponse {
  chart?: { result?: YahooChartResult[] | null; error?: { description?: string } | null };
}

export interface YahooSparkResponse {
  spark?: { result?: Array<{ symbol: string; response?: Array<{ meta: YahooMeta; timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> }> };
}

/**
 * Closing prices per symbol from one batched spark response, skipping the null-padded gaps.
 * Spark carries no open/high/low, so each point is returned as [time, close].
 */
export function parseSparkCloses(data: YahooSparkResponse, daily = false): Array<{ symbol: string; meta: YahooMeta; closes: Array<[number, number]> }> {
  const out: Array<{ symbol: string; meta: YahooMeta; closes: Array<[number, number]> }> = [];
  for (const r of data.spark?.result ?? []) {
    const resp = r.response?.[0];
    if (!resp) continue;
    const ts = resp.timestamp ?? [];
    const cl = resp.indicators?.quote?.[0]?.close ?? [];
    const closes: Array<[number, number]> = [];
    for (let i = 0; i < ts.length; i++) if (cl[i] != null) closes.push([ts[i], cl[i]!]);
    out.push({ symbol: r.symbol, meta: resp.meta, closes: withLatestPrice(closes, resp.meta, daily) });
  }
  return out;
}

/**
 * Daily closes: Yahoo leaves today's close empty for NSE/BSE stocks, so add today's point from
 * the live price when the series stops on an earlier exchange-local day.
 */
export function withLatestPrice(closes: Array<[number, number]>, meta: YahooMeta, daily: boolean): Array<[number, number]> {
  const price = meta.regularMarketPrice;
  const t = meta.regularMarketTime;
  if (!daily || price == null || t == null || closes.length === 0) return closes;
  const off = meta.gmtoffset ?? 0;
  const day = (x: number) => Math.floor((x + off) / 86400);
  const last = closes[closes.length - 1];
  return day(t) > day(last[0]) ? [...closes, [t, price]] : closes;
}

/** OHLCV bars from a chart result, skipping the null-padded gaps Yahoo inserts. */
export function parseCandles(result: YahooChartResult): Candle[] {
  const ts = result.timestamp ?? [];
  const q = result.indicators.quote[0] ?? { open: [], high: [], low: [], close: [], volume: [] };
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: ts[i], o, h, l, c, v: q.volume[i] ?? 0 });
  }
  return candles;
}

/**
 * Yahoo sends the current day's daily candle empty for NSE/BSE stocks. If `daily` is missing
 * its last bar, rebuild it from that day's 5-minute bars (fetched by `loadIntraday`) and append
 * it. Volume comes from the day's reported total, because the 5-minute bars leave out the
 * opening and closing auctions.
 */
export async function appendTodayCandle(candles: Candle[], daily: YahooChartResult, loadIntraday: () => Promise<YahooChartResponse>): Promise<void> {
  const lastT = daily.timestamp?.at(-1);
  const price = daily.meta.regularMarketPrice;
  if (lastT == null || price == null) return;
  if (candles.length > 0 && candles[candles.length - 1].t >= lastT) return;
  const intraday = (await loadIntraday()).chart?.result?.[0];
  const bar = intraday ? sessionFromIntraday(lastT, parseCandles(intraday), price, daily.meta.regularMarketVolume) : null;
  if (bar) candles.push(bar);
}

/** Latest reported value of one fundamentals-timeseries type, e.g. "trailingMarketCap". */
export function latestTimeseriesValue(json: unknown, type: string): number | undefined {
  type Point = { reportedValue?: { raw?: number } };
  const results = (json as { timeseries?: { result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }> } }).timeseries?.result ?? [];
  for (const r of results) {
    if (r.meta?.type?.[0] !== type) continue;
    const points = (r[type] as Point[] | undefined) ?? [];
    return points.filter((p) => p?.reportedValue?.raw != null).at(-1)?.reportedValue?.raw;
  }
  return undefined;
}

/** Yahoo exchange codes this site covers, with the names its search index uses. */
const SEARCH_EXCHANGES: Record<string, string> = {
  NMS: 'NASDAQ',
  NGM: 'NASDAQ',
  NCM: 'NASDAQ',
  NYQ: 'NYSE',
  ASE: 'NYSE American',
  PCX: 'NYSE Arca',
  BTS: 'Cboe',
  NSI: 'NSE',
  BSE: 'BSE',
};

/**
 * Search results Yahoo knows that are listed where this site works (NSE, BSE and the US
 * exchanges), as search-index rows. Crypto, funds and foreign listings are left out.
 */
export function parseSearchSymbols(json: unknown): Array<[string, string, string, 's' | 'e' | 'i']> {
  const quotes = (json as { quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; exchange?: string; quoteType?: string }> }).quotes ?? [];
  const out: Array<[string, string, string, 's' | 'e' | 'i']> = [];
  for (const q of quotes) {
    if (!q.symbol || !q.exchange) continue;
    const kind = q.quoteType === 'EQUITY' ? 's' : q.quoteType === 'ETF' ? 'e' : q.quoteType === 'INDEX' ? 'i' : null;
    const exchange = SEARCH_EXCHANGES[q.exchange] ?? (kind === 'i' && q.symbol.startsWith('^') ? 'Index' : null);
    if (!kind || !exchange) continue;
    // Yahoo's long names carry suffixes like "Class A Common Stock"; the short name reads better.
    out.push([q.symbol, (q.longname ?? q.shortname ?? q.symbol).replace(/\s+(Class [A-C] )?Common Stock$/i, '').trim(), exchange, kind]);
  }
  return out;
}

/** Sector and industry of `symbol` from a search response. */
export function searchClassification(json: unknown, symbol: string): { sector?: string; industry?: string } {
  const quotes = (json as { quotes?: Array<{ symbol: string; sectorDisp?: string; sector?: string; industryDisp?: string; industry?: string }> }).quotes ?? [];
  const m = quotes.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
  return m ? { sector: m.sectorDisp ?? m.sector, industry: m.industryDisp ?? m.industry } : {};
}

export function relatedSymbols(json: unknown): string[] {
  const rec = (json as { finance?: { result?: Array<{ recommendedSymbols?: Array<{ symbol: string }> }> } }).finance?.result?.[0];
  return rec?.recommendedSymbols?.map((s) => s.symbol) ?? [];
}
