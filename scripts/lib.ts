/** Helpers for the data scripts: polite fetching with retries, and a small concurrency pool. */
import type { Candle } from '../src/lib/types.ts';
import { YAHOO_HOSTS, appendTodayCandle, parseCandles, yahooPath, type YahooChartResponse } from '../server/yahoo.ts';

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

/** Daily candles (including today's, see server/yahoo.ts) plus the exchange's UTC offset. */
export async function dailyCandles(symbol: string, range = '3mo'): Promise<{ candles: Candle[]; gmtoffset: number }> {
  const data = (await get(YAHOO_HOSTS[0] + yahooPath.chart(symbol, range, '1d'))) as YahooChartResponse;
  const r = data.chart?.result?.[0];
  if (!r) return { candles: [], gmtoffset: 0 };
  const candles = parseCandles(r);
  await appendTodayCandle(candles, r, async () => (await get(YAHOO_HOSTS[0] + yahooPath.chart(symbol, '1d', '5m'))) as YahooChartResponse);
  return { candles, gmtoffset: r.meta.gmtoffset ?? 0 };
}

/** Exchange-local date of a timestamp, "YYYY-MM-DD". */
export function localDate(t: number, gmtoffset: number): string {
  return new Date((t + gmtoffset) * 1000).toISOString().slice(0, 10);
}
