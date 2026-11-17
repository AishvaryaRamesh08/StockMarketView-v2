/** Helpers for the data scripts: polite fetching with retries, and a small concurrency pool. */
import type { Candle } from '../src/lib/types.ts';
import { sessionFromIntraday } from '../src/lib/candles.ts';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; StockMarketView data job)', Accept: 'application/json,text/csv,*/*' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with up to 4 attempts, backing off on rate limits and server errors. */
export async function get(url: string, as: 'json' | 'text' = 'json'): Promise<unknown> {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return as === 'json' ? res.json() : res.text();
      last = `HTTP ${res.status}`;
      if (res.status === 404) break;
      if (res.status === 429 || res.status >= 500) await sleep(1500 * 2 ** attempt);
    } catch (err) {
      last = String(err);
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`${url} -> ${last}`);
}

/** Runs `fn` over `items` with at most `limit` in flight, pausing briefly between calls. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, pauseMs = 100): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${items.length}`);
      await sleep(pauseMs);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

/** Minimal CSV line parser that handles quoted fields containing commas. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

interface YahooChart {
  chart?: {
    result?: Array<{
      meta: { gmtoffset?: number; regularMarketTime?: number; regularMarketPrice?: number };
      timestamp?: number[];
      indicators: { quote: Array<{ open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }> };
    }>;
  };
}

/** Daily candles plus the exchange's UTC offset, skipping Yahoo's empty placeholder bars. */
export async function dailyCandles(symbol: string, range = '3mo'): Promise<{ candles: Candle[]; gmtoffset: number }> {
  const data = (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`)) as YahooChart;
  const r = data.chart?.result?.[0];
  if (!r) return { candles: [], gmtoffset: 0 };
  const candles = parse(r);
  // Yahoo sends today's daily candle empty for NSE/BSE stocks: rebuild it from 5-minute bars.
  const lastT = r.timestamp?.at(-1);
  if (lastT != null && r.meta.regularMarketPrice != null && (candles.length === 0 || candles[candles.length - 1].t < lastT)) {
    const intraday = (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`)) as YahooChart;
    const ir = intraday.chart?.result?.[0];
    const bar = ir ? sessionFromIntraday(lastT, parse(ir), r.meta.regularMarketPrice) : null;
    if (bar) candles.push(bar);
  }
  return { candles, gmtoffset: r.meta.gmtoffset ?? 0 };
}

type YahooResult = NonNullable<NonNullable<YahooChart['chart']>['result']>[number];

function parse(r: YahooResult): Candle[] {
  const q = r.indicators.quote[0];
  const candles: Candle[] = [];
  (r.timestamp ?? []).forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) return;
    candles.push({ t, o, h, l, c, v: q.volume[i] ?? 0 });
  });
  return candles;
}

/** Exchange-local date of a timestamp, "YYYY-MM-DD". */
export function localDate(t: number, gmtoffset: number): string {
  return new Date((t + gmtoffset) * 1000).toISOString().slice(0, 10);
}
