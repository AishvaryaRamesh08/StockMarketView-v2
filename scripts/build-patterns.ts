#!/usr/bin/env node
/**
 * Scans every NIFTY 500 or S&P 500 stock for candlestick patterns on its latest COMPLETED daily
 * candle and writes patterns-<market>.json. Runs in GitHub Actions after each market closes.
 *
 *   node scripts/build-patterns.ts IN
 *   node scripts/build-patterns.ts US
 *
 * Reads data-out/universe.json if present, otherwise the published copy.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { lastValue, rsi, sma } from '../src/lib/indicators.ts';
import { DATA_BASE_URL, isMarketId, type PatternFeed, type PatternFeedHit, type Universe } from '../src/lib/marketData.ts';
import { marketOf, marketStatus } from '../src/lib/markets.ts';
import { detectAt, PATTERN_BIAS } from '../src/lib/patterns.ts';
import { dailyCandles, get, localDate, pool } from './lib.ts';

const market = process.argv[2];
if (!isMarketId(market)) {
  console.error('Usage: node scripts/build-patterns.ts IN|US');
  process.exit(1);
}

const OUT = new URL('../data-out/', import.meta.url);

async function loadUniverse(): Promise<Universe> {
  try {
    return JSON.parse(await readFile(new URL('universe.json', OUT), 'utf8')) as Universe;
  } catch {
    return (await get(`${DATA_BASE_URL}universe.json`)) as Universe;
  }
}

const universe = await loadUniverse();
const stocks = universe.markets[market];
// If the job runs while the market is open, today's candle is still forming: scan yesterday's.
const open = marketStatus(market).state === 'open';
console.log(`Scanning ${stocks.length} ${market} stocks${open ? ' (market open: using the previous session)' : ''}`);

const sessions = new Map<string, number>();
const results = await pool(stocks, 4, async (st) => {
  try {
    const { candles: all, gmtoffset } = await dailyCandles(st.s);
    const candles = open && marketOf(st.s) === market ? all.slice(0, -1) : all;
    if (candles.length < 25) return [];
    const i = candles.length - 1;
    const last = candles[i];
    const day = localDate(last.t, gmtoffset);
    sessions.set(day, (sessions.get(day) ?? 0) + 1);

    const patterns = detectAt(candles, i).filter((p) => p !== 'doji');
    if (!patterns.length) return [];
    const avgVol = lastValue(sma(candles.slice(0, i).map((c) => c.v), 20));
    const r = lastValue(rsi(candles.map((c) => c.c), 14));
    return patterns.map(
      (p): PatternFeedHit & { day: string } => ({
        s: st.s,
        n: st.n,
        sec: st.sec,
        p,
        b: PATTERN_BIAS[p],
        c: +last.c.toFixed(2),
        chg: +(((last.c - candles[i - 1].c) / candles[i - 1].c) * 100).toFixed(2),
        vr: avgVol ? +(last.v / avgVol).toFixed(2) : null,
        rsi: r != null ? Math.round(r) : null,
        day,
      }),
    );
  } catch (err) {
    console.warn(`  skip ${st.s}: ${(err as Error).message}`);
    return [];
  }
});

// The session most stocks ended on; drop hits from stale or suspended stocks.
const session = [...sessions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
const hits = results
  .flat()
  .filter((h) => h.day === session)
  .map(({ day: _day, ...h }) => h)
  // Strongest-looking first: unusual volume, then the size of the move.
  .sort((a, b) => (b.vr ?? 0) - (a.vr ?? 0) || Math.abs(b.chg) - Math.abs(a.chg));

const feed: PatternFeed = { market, session, generatedAt: new Date().toISOString(), scanned: stocks.length, hits };
await mkdir(OUT, { recursive: true });
await writeFile(new URL(`patterns-${market}.json`, OUT), JSON.stringify(feed));
console.log(`patterns-${market}.json: ${hits.length} patterns on ${session}`);
