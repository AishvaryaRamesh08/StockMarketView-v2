/**
 * Data API shared by the Cloudflare Pages Function (production) and the Vite dev middleware.
 *
 *   GET /api/chart?symbol=RELIANCE.NS&range=6mo&interval=1d
 *   GET /api/quotes?symbols=^NSEI,^GSPC,AAPL        (up to 20 symbols, one upstream call)
 *
 * Every upstream response is cached at the edge, so many visitors watching the same ticker
 * share one Yahoo request. All Yahoo-specific code lives in this file, so the provider can be
 * swapped without touching the frontend.
 */
import type { ChartResponse, Candle, Quote, QuotesResponse, ApiError } from '../src/lib/types.ts';

const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', 'ytd', '1y', '5y', '10y', 'max'] as const;
const INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '1d', '1wk', '1mo'] as const;
const SYMBOL_RE = /^[A-Za-z0-9.^=&-]{1,24}$/;
const MAX_QUOTES = 20;

/** Short ranges hold the live candle, so they expire fast; long history barely changes. */
function ttlFor(range: string): number {
  return ['1d', '5d', '1mo'].includes(range) ? 20 : 300;
}

const UPSTREAM_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UPSTREAM_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; StockMarketView/2.0)', Accept: 'application/json' };

interface EdgeCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

function edgeCache(): EdgeCache | undefined {
  // `caches.default` exists only on Cloudflare; locally we simply skip caching.
  return (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
}

function json(body: unknown, status: number, ttl = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl > 0 ? `public, max-age=${Math.min(ttl, 15)}, s-maxage=${ttl}` : 'no-store',
    },
  });
}

function fail(status: number, message: string): Response {
  return json({ error: message } satisfies ApiError, status);
}

async function upstream(path: string): Promise<unknown> {
  let lastStatus = 0;
  for (const host of UPSTREAM_HOSTS) {
    const res = await fetch(host + path, { headers: UPSTREAM_HEADERS });
    if (res.ok) return res.json();
    lastStatus = res.status;
    // A 404 means the symbol does not exist; trying the second host will not change that.
    if (res.status === 404) break;
  }
  throw new UpstreamError(lastStatus);
}

class UpstreamError extends Error {
  status: number;
  constructor(status: number) {
    super(`upstream ${status}`);
    this.status = status;
  }
}

/* ---------------------------------- chart ---------------------------------- */

interface YahooMeta {
  symbol: string;
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

interface YahooChartResult {
  meta: YahooMeta;
  timestamp?: number[];
  indicators: { quote: Array<{ open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }> };
}

function toQuote(meta: YahooMeta, prevClose: number | null): Quote {
  const price = meta.regularMarketPrice ?? null;
  const change = price != null && prevClose != null ? price - prevClose : null;
  return {
    symbol: meta.symbol,
    name: meta.longName ?? meta.shortName ?? meta.symbol,
    currency: meta.currency ?? 'USD',
    exchange: meta.fullExchangeName ?? '',
    timezone: meta.exchangeTimezoneName ?? 'UTC',
    type: meta.instrumentType ?? 'EQUITY',
    price,
    prevClose,
    change,
    changePct: change != null && prevClose ? (change / prevClose) * 100 : null,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    volume: meta.regularMarketVolume ?? null,
    high52: meta.fiftyTwoWeekHigh ?? null,
    low52: meta.fiftyTwoWeekLow ?? null,
    marketTime: meta.regularMarketTime ?? null,
    priceHint: meta.priceHint ?? 2,
  };
}

/**
 * Yesterday's close, or null when this response can't tell us. Yahoo's chartPreviousClose is
 * the close before the whole *range*, so it only means "yesterday" for a 1-day range.
 * The frontend takes day change from /api/quotes (always a 1-day range) when this is null.
 */
function dailyPrevClose(candles: Candle[], meta: YahooMeta, interval: string, range: string): number | null {
  if (meta.previousClose != null) return meta.previousClose;
  if (range === '1d') return meta.chartPreviousClose ?? null;
  if (interval === '1d' && candles.length >= 2) return candles[candles.length - 2].c;
  return null;
}

const INTRADAY_SECONDS: Record<string, number> = { '1m': 60, '2m': 120, '5m': 300, '15m': 900, '30m': 1800, '60m': 3600 };

/**
 * During market hours Yahoo appends a "live tick" bar stamped with the current time, off the
 * interval grid. Fold it into the bucket it belongs to so the chart never shows a stray bar.
 */
export function foldLiveTick(candles: Candle[], interval: string): void {
  const step = INTRADAY_SECONDS[interval];
  if (!step || candles.length < 2) return;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (last.t - prev.t >= step) return;
  prev.h = Math.max(prev.h, last.h);
  prev.l = Math.min(prev.l, last.l);
  prev.c = last.c;
  prev.v += last.v;
  candles.pop();
}

async function chart(params: URLSearchParams): Promise<Response> {
  const symbol = params.get('symbol') ?? '';
  const range = params.get('range') ?? '6mo';
  const interval = params.get('interval') ?? '1d';
  if (!SYMBOL_RE.test(symbol)) return fail(400, 'Invalid symbol');
  if (!(RANGES as readonly string[]).includes(range)) return fail(400, 'Invalid range');
  if (!(INTERVALS as readonly string[]).includes(interval)) return fail(400, 'Invalid interval');

  const data = (await upstream(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,
  )) as { chart?: { result?: YahooChartResult[] | null; error?: { description?: string } | null } };

  const result = data.chart?.result?.[0];
  if (!result) return fail(404, data.chart?.error?.description ?? 'No data for this symbol');

  const ts = result.timestamp ?? [];
  const q = result.indicators.quote[0] ?? { open: [], high: [], low: [], close: [], volume: [] };
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    // Yahoo pads gaps with nulls; a candle without OHLC cannot be drawn.
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: ts[i], o, h, l, c, v: q.volume[i] ?? 0 });
  }
  foldLiveTick(candles, interval);

  const body: ChartResponse = {
    quote: toQuote(result.meta, dailyPrevClose(candles, result.meta, interval, range)),
    range,
    interval,
    candles,
  };
  return json(body, 200, ttlFor(range));
}

/* --------------------------------- quotes ---------------------------------- */

async function quotes(params: URLSearchParams): Promise<Response> {
  const symbols = (params.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbols.length === 0 || symbols.length > MAX_QUOTES) return fail(400, `Pass 1–${MAX_QUOTES} symbols`);
  if (!symbols.every((s) => SYMBOL_RE.test(s))) return fail(400, 'Invalid symbol');

  // The spark endpoint returns many symbols in one call.
  const data = (await upstream(
    `/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1d&interval=5m`,
  )) as { spark?: { result?: Array<{ symbol: string; response?: Array<{ meta: YahooMeta; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> }> } };

  const out: Quote[] = [];
  for (const r of data.spark?.result ?? []) {
    const resp = r.response?.[0];
    if (!resp) continue;
    out.push(toQuote(resp.meta, resp.meta.previousClose ?? resp.meta.chartPreviousClose ?? null));
  }
  return json({ quotes: out } satisfies QuotesResponse, 200, 20);
}

/* --------------------------------- router ---------------------------------- */

export async function handleApi(request: Request, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  if (request.method !== 'GET') return fail(405, 'Method not allowed');
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  const cache = edgeCache();
  // Normalise the cache key so `?a=1&b=2` and `?b=2&a=1` share an entry.
  url.searchParams.sort();
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let res: Response;
  try {
    if (route === 'chart') res = await chart(url.searchParams);
    else if (route === 'quotes') res = await quotes(url.searchParams);
    else res = fail(404, 'Unknown endpoint');
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 0;
    if (status === 404) res = fail(404, 'Symbol not found');
    else if (status === 429) res = fail(503, 'The data provider is rate-limiting requests. Retrying shortly.');
    else res = fail(502, 'The data provider did not respond. Retrying shortly.');
  }

  if (cache && res.ok) {
    const put = cache.put(cacheKey, res.clone());
    if (waitUntil) waitUntil(put);
    else await put;
  }
  return res;
}
