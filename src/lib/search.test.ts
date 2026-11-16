import { describe, expect, it } from 'vitest';
import { searchSymbols, toEntry } from './search.ts';
import type { SymbolRow } from './types.ts';

const rows: SymbolRow[] = [
  ['^NSEI', 'NIFTY 50', 'NSE', 'i'],
  ['RELIANCE.NS', 'Reliance Industries Limited', 'NSE', 's'],
  ['RELIANCE.BO', 'Reliance Industries Ltd.', 'BSE', 's'],
  ['RELINFRA.NS', 'Reliance Infrastructure Limited', 'NSE', 's'],
  ['TCS.NS', 'Tata Consultancy Services Limited', 'NSE', 's'],
  ['AAPL', 'Apple Inc.', 'NASDAQ', 's'],
  ['APLE', 'Apple Hospitality REIT, Inc.', 'NYSE', 's'],
  ['TSLA', 'Tesla, Inc.', 'NASDAQ', 's'],
];
const entries = rows.map(toEntry);
const syms = (q: string, f: 'ALL' | 'IN' | 'US' = 'ALL') => searchSymbols(entries, q, f).map((e) => e.symbol);

describe('searchSymbols', () => {
  it('puts an exact symbol match first, NSE before BSE', () => {
    expect(syms('reliance').slice(0, 2)).toEqual(['RELIANCE.NS', 'RELIANCE.BO']);
  });
  it('matches by company name', () => {
    expect(syms('apple')[0]).toBe('AAPL');
    expect(syms('consultancy')).toEqual(['TCS.NS']);
  });
  it('finds indices without the caret', () => {
    expect(syms('nifty')[0]).toBe('^NSEI');
  });
  it('filters by market', () => {
    expect(syms('a', 'IN').every((s) => s.endsWith('.NS') || s.endsWith('.BO') || s.startsWith('^'))).toBe(true);
    expect(syms('tesla', 'IN')).toEqual([]);
  });
  it('returns nothing for an empty query', () => {
    expect(syms('  ')).toEqual([]);
  });
});
