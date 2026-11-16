import type { MarketId, SymbolRow } from './types.ts';
import { marketOf } from './markets.ts';

export interface SymbolEntry {
  symbol: string;
  /** Symbol without the .NS/.BO suffix, as traders type it. */
  base: string;
  name: string;
  exchange: string;
  kind: 's' | 'e' | 'i';
  market: MarketId;
  /** Lower-cased name for matching. */
  nameLc: string;
}

let indexPromise: Promise<SymbolEntry[]> | null = null;

/** Loaded on first use (≈240 KB gzipped), then kept in memory. */
export function loadSymbols(): Promise<SymbolEntry[]> {
  if (!indexPromise) {
    indexPromise = fetch('/symbols.json')
      .then((r) => {
        if (!r.ok) throw new Error('Could not load the symbol list');
        return r.json() as Promise<SymbolRow[]>;
      })
      .then((rows) => rows.map(toEntry))
      .catch((err) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

export function toEntry([symbol, name, exchange, kind]: SymbolRow): SymbolEntry {
  return {
    symbol,
    base: symbol.replace(/\.(NS|BO)$/i, '').replace(/^\^/, ''),
    name,
    exchange,
    kind,
    market: marketOf(symbol),
    nameLc: name.toLowerCase(),
  };
}

export type MarketFilter = 'ALL' | MarketId;

/**
 * Rank: exact symbol > symbol prefix > name word prefix > name substring.
 * Ties go to indices, then NSE over BSE (most Indian traders want the NSE line), then shorter symbols.
 */
export function searchSymbols(entries: SymbolEntry[], query: string, filter: MarketFilter = 'ALL', limit = 40): SymbolEntry[] {
  const q = query.trim().toLowerCase().replace(/^\^/, '');
  if (!q) return [];
  const scored: Array<{ e: SymbolEntry; score: number }> = [];
  for (const e of entries) {
    if (filter !== 'ALL' && e.market !== filter) continue;
    const base = e.base.toLowerCase();
    let score = 0;
    if (base === q) score = 100;
    else if (base.startsWith(q)) score = 80 - Math.min(base.length - q.length, 20);
    else if (e.nameLc.startsWith(q)) score = 60;
    else if (e.nameLc.includes(' ' + q)) score = 50;
    else if (q.length >= 3 && e.nameLc.includes(q)) score = 30;
    else continue;
    if (e.kind === 'i') score += 8;
    if (e.exchange === 'NSE') score += 3;
    if (e.kind === 'e') score -= 2;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.symbol.length - b.e.symbol.length || a.e.symbol.localeCompare(b.e.symbol));
  return scored.slice(0, limit).map((s) => s.e);
}

/** Suggestions shown before the user types anything. */
export const POPULAR: Record<MarketId, string[]> = {
  IN: ['^NSEI', '^BSESN', 'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS'],
  US: ['^GSPC', '^IXIC', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'SPY'],
};
