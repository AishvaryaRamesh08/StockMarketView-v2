#!/usr/bin/env node
/**
 * Builds universe.json: NIFTY 500 and S&P 500 constituents with sector, industry and market cap.
 * Runs weekly in GitHub Actions (constituents change rarely). Output goes to data-out/.
 *
 *   node scripts/build-universe.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import type { Universe, UniverseEntry } from '../src/lib/marketData.ts';
import { get, parseCsv, pool } from './lib.ts';

const OUT = new URL('../data-out/', import.meta.url);

async function marketCap(symbol: string): Promise<number | undefined> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const data = (await get(
      `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=trailingMarketCap&period1=${now - 30 * 86400}&period2=${now}`,
    )) as { timeseries?: { result?: Array<{ trailingMarketCap?: Array<{ reportedValue?: { raw?: number } }> }> } };
    const points = data.timeseries?.result?.[0]?.trailingMarketCap ?? [];
    return points.filter((p) => p?.reportedValue?.raw != null).at(-1)?.reportedValue?.raw;
  } catch {
    return undefined;
  }
}

async function yahooIndustry(symbol: string): Promise<string | undefined> {
  try {
    const data = (await get(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0&listsCount=0`)) as {
      quotes?: Array<{ symbol: string; industryDisp?: string; industry?: string }>;
    };
    const m = data.quotes?.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
    return m?.industryDisp ?? m?.industry;
  } catch {
    return undefined;
  }
}

async function india(): Promise<UniverseEntry[]> {
  const rows = parseCsv((await get('https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv', 'text')) as string);
  console.log(`NIFTY 500: ${rows.length} constituents`);
  return pool(rows, 4, async (r) => {
    const s = `${r.Symbol}.NS`;
    const [ind, cap] = await Promise.all([yahooIndustry(s), marketCap(s)]);
    return { s, n: r['Company Name'], sec: r.Industry, ind, cap };
  });
}

async function us(): Promise<UniverseEntry[]> {
  // Community-maintained S&P 500 list (github.com/datasets/s-and-p-500-companies), with GICS classification.
  const rows = parseCsv((await get('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv', 'text')) as string);
  console.log(`S&P 500: ${rows.length} constituents`);
  return pool(rows, 4, async (r) => {
    const s = r.Symbol.replace(/\./g, '-'); // Yahoo writes BRK.B as BRK-B
    return { s, n: r.Security, sec: r['GICS Sector'], ind: r['GICS Sub-Industry'], cap: await marketCap(s) };
  });
}

const [IN, US] = [await india(), await us()];
const universe: Universe = { generatedAt: new Date().toISOString(), markets: { IN, US } };
await mkdir(OUT, { recursive: true });
await writeFile(new URL('universe.json', OUT), JSON.stringify(universe));
const pct = (xs: UniverseEntry[], k: 'cap' | 'ind') => Math.round((xs.filter((x) => x[k] != null).length / xs.length) * 100);
console.log(`universe.json: IN ${IN.length} (cap ${pct(IN, 'cap')}%, industry ${pct(IN, 'ind')}%), US ${US.length} (cap ${pct(US, 'cap')}%)`);
