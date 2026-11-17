/**
 * Data API shared by the Cloudflare Worker (production) and the Vite dev middleware.
 *
 *   GET /api/chart?symbol=RELIANCE.NS&range=6mo&interval=1d
 *   GET /api/quotes?symbols=^NSEI,^GSPC,AAPL        (up to 20 symbols, one upstream call)
 *
 * Every upstream response is cached at the edge, so many visitors watching the same ticker
 * share one Yahoo request. All Yahoo-specific code lives in this file, so the provider can be
 * swapped without touching the frontend.
 */
import type { ChartResponse, Candle, CorporateEvent, Quote, QuotesResponse, ApiError, Profile } from '../src/lib/types.ts';
import { sessionFromIntraday } from '../src/lib/candles.ts';
import { DATA_BASE_URL, PULSE_INDICES, isMarketId, type PatternFeed, type Pulse, type PulseStock, type Universe } from '../src/lib/marketData.ts';

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

interface YahooChartResult {
  meta: YahooMeta;
  timestamp?: number[];
  events?: {
    dividends?: Record<string, { amount: number; date: number }>;
    splits?: Record<string, { date: number; numerator: number; denominator: number }>;
  };
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
export function dailyPrevClose(candles: Candle[], meta: YahooMeta, interval: string, range: string): number | null {
  if (meta.previousClose != null) return meta.previousClose;
  if (range === '1d') return meta.chartPreviousClose ?? null;
  if (interval === '1d' && candles.length > 0 && meta.regularMarketTime != null) {
    // The close of the last daily candle from *before* the latest price's trading day.
    // Don't just take the second-to-last candle: Yahoo sometimes sends today's candle empty,
    // and that candle is dropped, which would shift "yesterday" back a day.
    const off = meta.gmtoffset ?? 0;
    const day = (t: number) => Math.floor((t + off) / 86400);
    const today = day(meta.regularMarketTime);
    for (let i = candles.length - 1; i >= 0; i--) if (day(candles[i].t) < today) return candles[i].c;
  }
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

/** OHLCV bars from a Yahoo chart result, skipping the null-padded gaps it inserts. */
function parseCandles(result: YahooChartResult): Candle[] {
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

  const candles = parseCandles(result);
  foldLiveTick(candles, interval);

  // Yahoo sends today's daily candle empty for NSE/BSE stocks. Rebuild it from today's
  // 5-minute bars so daily charts (and patterns) include the latest session.
  const ts = result.timestamp ?? [];
  const lastT = ts[ts.length - 1];
  if (interval === '1d' && range !== '1d' && lastT != null && result.meta.regularMarketPrice != null && (candles.length === 0 || candles[candles.length - 1].t < lastT)) {
    try {
      const intraday = (await upstream(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`)) as { chart?: { result?: YahooChartResult[] | null } };
      const r = intraday.chart?.result?.[0];
      const bar = r ? sessionFromIntraday(lastT, parseCandles(r), result.meta.regularMarketPrice) : null;
      if (bar) candles.push(bar);
    } catch {
      /* keep the chart without today's candle rather than failing */
    }
  }

  const events: CorporateEvent[] = [];
  for (const d of Object.values(result.events?.dividends ?? {})) events.push({ t: d.date, kind: 'dividend', value: String(d.amount) });
  for (const s of Object.values(result.events?.splits ?? {})) events.push({ t: s.date, kind: 'split', value: `${s.numerator}:${s.denominator}` });
  events.sort((a, b) => a.t - b.t);

  const body: ChartResponse = {
    quote: toQuote(result.meta, dailyPrevClose(candles, result.meta, interval, range)),
    range,
    interval,
    candles,
    events,
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
    const q = toQuote(resp.meta, resp.meta.previousClose ?? resp.meta.chartPreviousClose ?? null);
    const closes = (resp.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => c != null);
    // A sparkline needs ~60 points at most; round to keep the payload small.
    const step = Math.max(1, Math.ceil(closes.length / 60));
    q.spark = closes.filter((_, i) => i % step === 0 || i === closes.length - 1).map((c) => +c.toFixed(4));
    out.push(q);
  }
  return json({ quotes: out } satisfies QuotesResponse, 200, 20);
}

/* --------------------------------- profile --------------------------------- */

/**
 * Sector, industry, market cap, P/E and related symbols, from Yahoo endpoints that work
 * without a login. Each source is optional; whatever fails is simply left out.
 * Cached for 6 hours because none of it changes during the day.
 */
async function profile(params: URLSearchParams): Promise<Response> {
  const symbol = params.get('symbol') ?? '';
  if (!SYMBOL_RE.test(symbol)) return fail(400, 'Invalid symbol');
  const now = Math.floor(Date.now() / 1000);
  const enc = encodeURIComponent(symbol);

  const [search, series, related] = await Promise.allSettled([
    upstream(`/v1/finance/search?q=${enc}&quotesCount=5&newsCount=0&listsCount=0`),
    upstream(`/ws/fundamentals-timeseries/v1/finance/timeseries/${enc}?type=trailingPeRatio,trailingMarketCap&period1=${now - 30 * 86400}&period2=${now}`),
    upstream(`/v6/finance/recommendationsbysymbol/${enc}`),
  ]);

  const out: Profile = { symbol };

  if (search.status === 'fulfilled') {
    const quotes = (search.value as { quotes?: Array<{ symbol: string; sectorDisp?: string; sector?: string; industryDisp?: string; industry?: string }> }).quotes ?? [];
    const match = quotes.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
    if (match) {
      out.sector = match.sectorDisp ?? match.sector;
      out.industry = match.industryDisp ?? match.industry;
    }
  }

  if (series.status === 'fulfilled') {
    type Point = { reportedValue?: { raw?: number } };
    const results = (series.value as { timeseries?: { result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }> } }).timeseries?.result ?? [];
    for (const r of results) {
      const type = r.meta?.type?.[0];
      const points = (type ? (r[type] as Point[] | undefined) : undefined) ?? [];
      const latest = points.filter((p) => p?.reportedValue?.raw != null).at(-1)?.reportedValue?.raw;
      if (latest == null) continue;
      if (type === 'trailingPeRatio') out.pe = latest;
      if (type === 'trailingMarketCap') out.marketCap = latest;
    }
  }

  if (related.status === 'fulfilled') {
    const rec = (related.value as { finance?: { result?: Array<{ recommendedSymbols?: Array<{ symbol: string }> }> } }).finance?.result?.[0];
    const syms = rec?.recommendedSymbols?.map((s) => s.symbol).filter((s) => SYMBOL_RE.test(s));
    if (syms?.length) out.related = syms;
  }

  return json(out, 200, 6 * 3600);
}

/* ------------------------- published market data -------------------------- */

const memoryCache = new Map<string, { at: number; body: unknown }>();

/**
 * A JSON file published by the Market data workflow, cached at the edge (or in memory when
 * running locally) for `ttl` seconds.
 */
async function dataFile<T>(name: string, ttl: number): Promise<T | null> {
  // Local development: the Vite dev server can supply freshly built files from data-out/.
  const local = (globalThis as { __smvLocalData?: (name: string) => Promise<unknown> }).__smvLocalData;
  if (local) {
    const body = await local(name);
    if (body) return body as T;
  }
  const url = DATA_BASE_URL + name;
  const cache = edgeCache();
  const key = new Request(`https://data.cache/${name}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return (await hit.json()) as T;
  } else {
    const hit = memoryCache.get(url);
    if (hit && Date.now() - hit.at < ttl * 1000) return hit.body as T;
  }
  const res = await fetch(url, { headers: UPSTREAM_HEADERS, redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(res.status);
  const body = (await res.json()) as T;
  if (cache) await cache.put(key, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `public, s-maxage=${ttl}` } }));
  else memoryCache.set(url, { at: Date.now(), body });
  return body;
}

async function universeRoute(params: URLSearchParams): Promise<Response> {
  const market = params.get('market');
  if (!isMarketId(market)) return fail(400, 'market must be IN or US');
  const u = await dataFile<Universe>('universe.json', 6 * 3600);
  if (!u) return fail(404, 'The stock universe has not been published yet');
  return json({ generatedAt: u.generatedAt, stocks: u.markets[market] }, 200, 6 * 3600);
}

async function patternsRoute(params: URLSearchParams): Promise<Response> {
  const market = params.get('market');
  if (!isMarketId(market)) return fail(400, 'market must be IN or US');
  const feed = await dataFile<PatternFeed>(`patterns-${market}.json`, 600);
  if (!feed) return fail(404, 'No pattern scan has been published yet');
  return json(feed, 200, 600);
}

/**
 * Live snapshot of a whole market: every NIFTY 500 / S&P 500 stock's price, change and volume,
 * plus the main indices. 25 batched calls of 20 symbols, cached for 60 seconds, so it costs
 * Yahoo at most 26 requests a minute per market however many people are watching.
 */
async function pulseRoute(params: URLSearchParams): Promise<Response> {
  const market = params.get('market');
  if (!isMarketId(market)) return fail(400, 'market must be IN or US');
  const u = await dataFile<Universe>('universe.json', 6 * 3600);
  if (!u) return fail(404, 'The stock universe has not been published yet');
  const universe = u.markets[market];
  const bySymbol = new Map(universe.map((e) => [e.s, e]));

  type Spark = { spark?: { result?: Array<{ symbol: string; response?: Array<{ meta: YahooMeta; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> }> } };
  const batches: string[][] = [];
  for (let i = 0; i < universe.length; i += MAX_QUOTES) batches.push(universe.slice(i, i + MAX_QUOTES).map((e) => e.s));
  const encode = (syms: string[]) => syms.map(encodeURIComponent).join(',');

  const [indexRes, ...stockRes] = await Promise.allSettled([
    upstream(`/v7/finance/spark?symbols=${encode(PULSE_INDICES[market])}&range=1d&interval=5m`),
    ...batches.map((b) => upstream(`/v7/finance/spark?symbols=${encode(b)}&range=1d&interval=1d`)),
  ]);

  const indices: Quote[] = [];
  if (indexRes.status === 'fulfilled') {
    for (const r of (indexRes.value as Spark).spark?.result ?? []) {
      const resp = r.response?.[0];
      if (!resp) continue;
      const q = toQuote(resp.meta, resp.meta.previousClose ?? resp.meta.chartPreviousClose ?? null);
      const closes = (resp.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => c != null);
      const step = Math.max(1, Math.ceil(closes.length / 60));
      q.spark = closes.filter((_, i) => i % step === 0 || i === closes.length - 1).map((c) => +c.toFixed(2));
      indices.push(q);
    }
    indices.sort((a, b) => PULSE_INDICES[market].indexOf(a.symbol) - PULSE_INDICES[market].indexOf(b.symbol));
  }

  const stocks: PulseStock[] = [];
  let asOf = 0;
  for (const res of stockRes) {
    if (res.status !== 'fulfilled') continue;
    for (const r of (res.value as Spark).spark?.result ?? []) {
      const m = r.response?.[0]?.meta;
      const e = bySymbol.get(r.symbol);
      if (!m || !e || m.regularMarketPrice == null) continue;
      const prev = m.previousClose ?? m.chartPreviousClose;
      const v = m.regularMarketVolume ?? 0;
      stocks.push({
        s: e.s,
        n: e.n,
        sec: e.sec,
        p: +m.regularMarketPrice.toFixed(2),
        chg: prev ? +(((m.regularMarketPrice - prev) / prev) * 100).toFixed(2) : 0,
        v,
        t: Math.round(m.regularMarketPrice * v),
        cap: e.cap,
      });
      if ((m.regularMarketTime ?? 0) > asOf) asOf = m.regularMarketTime!;
    }
  }
  if (stocks.length === 0) return fail(502, 'The data provider did not respond. Retrying shortly.');
  return json({ market, asOf, indices, stocks } satisfies Pulse, 200, 60);
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
    else if (route === 'profile') res = await profile(url.searchParams);
    else if (route === 'pulse') res = await pulseRoute(url.searchParams);
    else if (route === 'patterns') res = await patternsRoute(url.searchParams);
    else if (route === 'universe') res = await universeRoute(url.searchParams);
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
