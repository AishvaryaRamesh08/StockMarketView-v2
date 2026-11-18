import { detectPatterns } from '../../src/lib/patterns.ts';
import { writeFileSync } from 'node:fs';

/**
 * Exports five years of daily candles for 30 large Indian and US stocks, with this site's pattern
 * hits, for compare.py to check against TA-Lib. Usage (with the dev server running):
 *   node --experimental-strip-types scripts/talib-check/export.ts [http://localhost:5173]
 */
const base = process.argv[2] ?? 'http://localhost:5173';
const symbols = ['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS','SBIN.NS','ITC.NS','LT.NS','AXISBANK.NS','MARUTI.NS','SUNPHARMA.NS','TATASTEEL.NS','BHARTIARTL.NS','HINDUNILVR.NS','ASIANPAINT.NS',
  'AAPL','MSFT','NVDA','AMZN','GOOGL','META','JPM','XOM','JNJ','WMT','PG','KO','TSLA','V','UNH'];
const out: Record<string, { candles: unknown[]; hits: unknown[] }> = {};
for (const s of symbols) {
  const r = await fetch(`${base}/api/chart?symbol=${encodeURIComponent(s)}&range=5y&interval=1d`);
  const j = await r.json() as { candles: { t: number; o: number; h: number; l: number; c: number; v: number }[] };
  // Drop today's possibly unfinished candle.
  const candles = j.candles.slice(0, -1);
  out[s] = { candles, hits: detectPatterns(candles).map((h) => ({ i: h.index, p: h.pattern })) };
}
writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(out));
console.log(Object.entries(out).map(([s, v]) => `${s}:${v.candles.length}`).join(' '));
