import { describe, expect, it } from 'vitest';
import { compareValues, nextSort, sortRows } from './sort.ts';

const rows = [
  { s: 'TSLA', pnl: 90 },
  { s: 'aapl', pnl: -40 },
  { s: 'MSFT', pnl: null },
  { s: 'NVDA', pnl: 90 },
];
const value = (r: (typeof rows)[number], k: 'stock' | 'pnl') => (k === 'stock' ? r.s : r.pnl);

describe('sortRows', () => {
  it('sorts numbers both ways, keeping missing values last and ties in order', () => {
    expect(sortRows(rows, { key: 'pnl', dir: 'desc' }, value).map((r) => r.s)).toEqual(['TSLA', 'NVDA', 'aapl', 'MSFT']);
    expect(sortRows(rows, { key: 'pnl', dir: 'asc' }, value).map((r) => r.s)).toEqual(['aapl', 'TSLA', 'NVDA', 'MSFT']);
  });
  it('sorts text alphabetically, ignoring case', () => {
    expect(sortRows(rows, { key: 'stock', dir: 'asc' }, value).map((r) => r.s)).toEqual(['aapl', 'MSFT', 'NVDA', 'TSLA']);
  });
  it('leaves the order alone with no sort column', () => {
    expect(sortRows(rows, { key: null, dir: 'asc' }, value)).toEqual(rows);
  });
  it('compares text with numbers in it naturally', () => {
    expect(compareValues('Nov 9', 'Nov 10')).toBeLessThan(0);
  });
});

describe('nextSort', () => {
  it('starts in the natural direction, flips, then returns to the default order', () => {
    let s = nextSort<'pnl' | 'stock'>({ key: null, dir: 'asc' }, 'pnl', 'desc');
    expect(s).toEqual({ key: 'pnl', dir: 'desc' });
    s = nextSort(s, 'pnl', 'desc');
    expect(s).toEqual({ key: 'pnl', dir: 'asc' });
    s = nextSort(s, 'pnl', 'desc');
    expect(s.key).toBeNull();
    expect(nextSort(s, 'stock', 'asc')).toEqual({ key: 'stock', dir: 'asc' });
  });
});
