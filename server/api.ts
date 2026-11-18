/**
 * Data API shared by the Cloudflare Worker (production) and the Vite dev middleware.
 *
 *   GET /api/chart?symbol=RELIANCE.NS&range=6mo&interval=1d
 *   GET /api/quotes?symbols=^NSEI,^GSPC,AAPL        (up to 20 symbols, one upstream call)
 *
 * Every upstream response is cached at the edge, so many visitors watching the same ticker
 * share one upstream request. Everything Yahoo-specific lives in server/yahoo.ts.
 */
import type { ChartResponse, Candle, ClosesResponse, CorporateEvent, Quote, QuotesResponse, ApiError, Profile } from '../src/lib/types.ts';
import {
  YAHOO_HOSTS,
  YAHOO_MAX_BATCH,
  appendTodayCandle,
  latestTimeseriesValue,
  parseCandles,
  parseSparkCloses,
  relatedSymbols,
  searchClassification,
  yahooPath,
  type YahooChartResponse,
  type YahooMeta,
  type YahooSparkResponse,
} from './yahoo.ts';
import { NEWS_FEEDS, mergeNews, parseRss, type NewsResponse } from './news.ts';
import { DATA_BASE_URL, PULSE_INDICES, isMarketId, type PatternFeed, type Pulse, type PulseStock, type Universe } from '../src/lib/marketData.ts';

const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', 'ytd', '1y', '5y', '10y', 'max'] as const;
const INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '1d', '1wk', '1mo'] as const;
const SYMBOL_RE = /^[A-Za-z0-9.^=&-]{1,24}$/;
const MAX_QUOTES = YAHOO_MAX_BATCH;

/** Short ranges hold the live candle, so they expire fast; long history barely changes. */
function ttlFor(range: string): number {
  return ['1d', '5d', '1mo'].includes(range) ? 20 : 300;
}

const UPSTREAM_HOSTS = YAHOO_HOSTS;
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

async function chart(params: URLSearchParams): Promise<Response> {
  const symbol = params.get('symbol') ?? '';
  const range = params.get('range') ?? '6mo';
  const interval = params.get('interval') ?? '1d';
  if (!SYMBOL_RE.test(symbol)) return fail(400, 'Invalid symbol');
  if (!(RANGES as readonly string[]).includes(range)) return fail(400, 'Invalid range');
  if (!(INTERVALS as readonly string[]).includes(interval)) return fail(400, 'Invalid interval');

  const data = (await upstream(yahooPath.chart(symbol, range, interval, true))) as YahooChartResponse;

  const result = data.chart?.result?.[0];
  if (!result) return fail(404, data.chart?.error?.description ?? 'No data for this symbol');

  const candles = parseCandles(result);
  foldLiveTick(candles, interval);

  // Daily charts: add today's candle when the provider left it empty (see server/yahoo.ts).
  if (interval === '1d' && range !== '1d') {
    try {
      await appendTodayCandle(candles, result, async () => (await upstream(yahooPath.chart(symbol, '1d', '5m'))) as YahooChartResponse);
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

  const data = (await upstream(yahooPath.spark(symbols, '1d', '5m'))) as YahooSparkResponse;

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

/**
 * Closing prices for up to 20 symbols in one upstream call, for the compare overlay: one
 * request covers every compared stock instead of one each. Cached like the chart route.
 */
async function closes(params: URLSearchParams): Promise<Response> {
  const symbols = (params.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const range = params.get('range') ?? '6mo';
  const interval = params.get('interval') ?? '1d';
  if (symbols.length === 0 || symbols.length > MAX_QUOTES) return fail(400, `Pass 1–${MAX_QUOTES} symbols`);
  if (!symbols.every((s) => SYMBOL_RE.test(s))) return fail(400, 'Invalid symbol');
  if (!(RANGES as readonly string[]).includes(range)) return fail(400, 'Invalid range');
  if (!(INTERVALS as readonly string[]).includes(interval)) return fail(400, 'Invalid interval');
  const data = (await upstream(yahooPath.spark(symbols, range, interval))) as YahooSparkResponse;
  const series = parseSparkCloses(data, interval === '1d').map((r) => {
    const q = toQuote(r.meta, r.meta.previousClose ?? r.meta.chartPreviousClose ?? null);
    return { symbol: r.symbol, name: q.name, timezone: q.timezone, closes: r.closes };
  });
  return json({ series } satisfies ClosesResponse, 200, ttlFor(range));
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

  const [search, series, related] = await Promise.allSettled([
    upstream(yahooPath.search(symbol)),
    upstream(yahooPath.timeseries(symbol, ['trailingPeRatio', 'trailingMarketCap'], now - 30 * 86400, now)),
    upstream(yahooPath.related(symbol)),
  ]);

  const out: Profile = { symbol };

  if (search.status === 'fulfilled') {
    const c = searchClassification(search.value, symbol);
    out.sector = c.sector;
    out.industry = c.industry;
  }

  if (series.status === 'fulfilled') {
    out.pe = latestTimeseriesValue(series.value, 'trailingPeRatio');
    out.marketCap = latestTimeseriesValue(series.value, 'trailingMarketCap');
  }

  if (related.status === 'fulfilled') {
    const syms = relatedSymbols(related.value).filter((s) => SYMBOL_RE.test(s));
    if (syms.length) out.related = syms;
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
 * plus the main indices. 25 batched calls of 20 symbols, cached for 2 minutes, so it costs
 * Yahoo at most 26 requests every 2 minutes per market however many people are watching.
 */
async function pulseRoute(params: URLSearchParams): Promise<Response> {
  const market = params.get('market');
  if (!isMarketId(market)) return fail(400, 'market must be IN or US');
  const u = await dataFile<Universe>('universe.json', 6 * 3600);
  if (!u) return fail(404, 'The stock universe has not been published yet');
  const universe = u.markets[market];
  const bySymbol = new Map(universe.map((e) => [e.s, e]));

  type Spark = YahooSparkResponse;
  const batches: string[][] = [];
  for (let i = 0; i < universe.length; i += MAX_QUOTES) batches.push(universe.slice(i, i + MAX_QUOTES).map((e) => e.s));

  const [indexRes, ...stockRes] = await Promise.allSettled([
    upstream(yahooPath.spark(PULSE_INDICES[market], '1d', '5m')),
    ...batches.map((b) => upstream(yahooPath.spark(b, '1d', '1d'))),
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
  return json({ market, asOf, indices, stocks } satisfies Pulse, 200, 120);
}

/**
 * Latest market headlines for India or the US from public RSS feeds, cached for an hour:
 * one fetch per feed per hour per Cloudflare location, however many people read them.
 */
async function newsRoute(params: URLSearchParams): Promise<Response> {
  const market = params.get('market');
  if (!isMarketId(market)) return fail(400, 'market must be IN or US');
  const results = await Promise.allSettled(
    NEWS_FEEDS[market].map(async (f) => {
      const res = await fetch(f.url, { headers: { 'User-Agent': UPSTREAM_HEADERS['User-Agent'], Accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!res.ok) throw new UpstreamError(res.status);
      return parseRss(await res.text(), f.name);
    }),
  );
  const lists = results.filter((r): r is PromiseFulfilledResult<ReturnType<typeof parseRss>> => r.status === 'fulfilled').map((r) => r.value);
  if (!lists.length) return fail(502, "The news feeds didn't respond. Retrying later.");
  return json({ market, items: mergeNews(lists) } satisfies NewsResponse, 200, 3600);
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
    else if (route === 'news') res = await newsRoute(url.searchParams);
    else if (route === 'closes') res = await closes(url.searchParams);
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
