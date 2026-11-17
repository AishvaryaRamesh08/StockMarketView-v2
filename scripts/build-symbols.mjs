#!/usr/bin/env node
/**
 * Builds public/symbols.json, the ticker search index, from:
 *   - NSE's current equity list (official, refreshed on every run)
 *   - data/india-symbols.csv, the v1 project's list, used for BSE (.BO) symbols
 *   - NASDAQ Trader's symbol directories for every NASDAQ, NYSE, NYSE American, NYSE Arca and Cboe listing
 *
 * Output rows: [yahooSymbol, name, exchange, kind] with kind s=stock, e=ETF, i=index.
 * Run with `npm run symbols`. Commit the result; the site does not fetch these sources at runtime.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { YAHOO_HOSTS, YAHOO_MAX_BATCH, yahooPath } from '../server/yahoo.ts';

const ROOT = new URL('..', import.meta.url);
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; StockMarketView symbol builder)' };

const INDICES = [
  ['^NSEI', 'NIFTY 50', 'NSE'],
  ['^NSEBANK', 'NIFTY Bank', 'NSE'],
  ['^CNXIT', 'NIFTY IT', 'NSE'],
  ['^BSESN', 'S&P BSE SENSEX', 'BSE'],
  ['^GSPC', 'S&P 500', 'US'],
  ['^IXIC', 'NASDAQ Composite', 'US'],
  ['^NDX', 'NASDAQ 100', 'US'],
  ['^DJI', 'Dow Jones Industrial Average', 'US'],
  ['^RUT', 'Russell 2000', 'US'],
  ['^VIX', 'CBOE Volatility Index', 'US'],
];

const US_EXCHANGES = { A: 'NYSE American', N: 'NYSE', P: 'NYSE Arca', Z: 'Cboe', V: 'IEX' };

/** Minimal CSV line parser that handles quoted fields containing commas. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "Apple Inc. - Common Stock" -> "Apple Inc." */
function cleanUsName(name) {
  return name
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+(Common Stock|Ordinary Shares|Class [A-Z] Common Stock|Common Shares|American Depositary Shares.*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "TATA MOTORS LTD." -> "Tata Motors Ltd." (BSE names in the v1 list are upper case). */
function titleCase(name) {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ltd|Llp|Inc)\b/g, (m) => m);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function nse() {
  const text = await fetchText('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv');
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map(parseCsvLine)
    .filter(([sym]) => sym)
    .map(([sym, name]) => [`${sym}.NS`, name, 'NSE', 's']);
}

async function bse() {
  const text = await readFile(new URL('data/india-symbols.csv', ROOT), 'latin1');
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map(parseCsvLine)
    .filter(([sym]) => sym?.endsWith('.BO'))
    .map(([sym, name]) => [sym, titleCase(name || sym), 'BSE', 's']);
}

async function us() {
  const rows = [];
  const nasdaq = await fetchText('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt');
  for (const line of nasdaq.split(/\r?\n/).slice(1)) {
    const [sym, name, , test, , , etf] = line.split('|');
    if (!sym || !name || test === 'Y' || sym.startsWith('File Creation')) continue;
    rows.push([sym, cleanUsName(name), 'NASDAQ', etf === 'Y' ? 'e' : 's']);
  }
  const other = await fetchText('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt');
  for (const line of other.split(/\r?\n/).slice(1)) {
    const [sym, name, exch, , etf, , test] = line.split('|');
    if (!sym || !name || test === 'Y' || sym.startsWith('File Creation')) continue;
    // Preferred shares and units use `$` / `.` suffixes; Yahoo spells class shares with `-` (BRK.B -> BRK-B).
    if (sym.includes('$')) continue;
    rows.push([sym.replace(/\./g, '-'), cleanUsName(name), US_EXCHANGES[exch] ?? 'US', etf === 'Y' ? 'e' : 's']);
  }
  return rows;
}

/**
 * The BSE list dates from 2021, so it includes merged and delisted companies (e.g. HDFC Ltd).
 * Keep only symbols Yahoo has a trade for in the last 30 days, checked 20 at a time through the
 * same batch endpoint the site uses. Takes about a minute.
 */
async function keepActive(rows) {
  const cutoff = Date.now() / 1000 - 30 * 86400;
  const active = new Set();
  for (let i = 0; i < rows.length; i += YAHOO_MAX_BATCH) {
    const batch = rows.slice(i, i + YAHOO_MAX_BATCH).map((r) => r[0]);
    const url = YAHOO_HOSTS[0] + yahooPath.spark(batch, '5d', '1d');
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) {
        const data = await res.json();
        for (const r of data.spark?.result ?? []) {
          const t = r.response?.[0]?.meta?.regularMarketTime;
          if (t && t > cutoff) active.add(r.symbol);
        }
      }
    } catch {
      /* treat the batch as unverified and drop it */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return rows.filter((r) => active.has(r[0]));
}

const [nseRows, allBseRows, usRows] = await Promise.all([nse(), bse(), us()]);
const bseRows = await keepActive(allBseRows);
console.log(`BSE: kept ${bseRows.length} of ${allBseRows.length} symbols with a trade in the last 30 days`);
const seen = new Set();
const all = [];
for (const row of [...INDICES.map(([s, n, e]) => [s, n, e, 'i']), ...nseRows, ...bseRows, ...usRows]) {
  if (seen.has(row[0])) continue;
  seen.add(row[0]);
  all.push(row);
}

await writeFile(new URL('public/symbols.json', ROOT), JSON.stringify(all));
console.log(`symbols.json: ${all.length} rows (NSE ${nseRows.length}, BSE ${bseRows.length}, US ${usRows.length}, indices ${INDICES.length})`);
