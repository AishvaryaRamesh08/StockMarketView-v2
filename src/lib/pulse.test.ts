import { describe, expect, it } from 'vitest';
import { breadth, findPeers, topMovers } from './pulse.ts';
import type { PulseStock, UniverseEntry } from './marketData.ts';

const st = (s: string, chg: number, p = 100, v = 1000, sec = 'Tech', cap = 1e9): PulseStock => ({ s, n: s, sec, p, chg, v, t: p * v, cap });

describe('movers and breadth', () => {
  const stocks = [st('A', 5), st('B', -4), st('C', 1, 10, 100000), st('D', 0), st('E', 2, 100, 0)];
  it('ranks gainers, losers and most active by value traded, skipping untraded stocks', () => {
    const m = topMovers(stocks, 2);
    expect(m.gainers.map((s) => s.s)).toEqual(['A', 'C']);
    expect(m.losers.map((s) => s.s)).toEqual(['B', 'D']);
    expect(m.active[0].s).toBe('C');
    expect([...m.gainers, ...m.losers, ...m.active].some((s) => s.s === 'E')).toBe(false);
  });
  it('counts advancers and decliners', () => {
    expect(breadth(stocks)).toEqual({ up: 3, down: 1, flat: 1 });
  });
});

describe('findPeers', () => {
  const u: UniverseEntry[] = [
    { s: 'TCS.NS', n: 'TCS', sec: 'IT', ind: 'IT Services', cap: 9 },
    { s: 'INFY.NS', n: 'Infosys', sec: 'IT', ind: 'IT Services', cap: 6 },
    { s: 'WIPRO.NS', n: 'Wipro', sec: 'IT', ind: 'IT Services', cap: 3 },
    { s: 'TATAELXSI.NS', n: 'Tata Elxsi', sec: 'IT', ind: 'Software', cap: 1 },
    { s: 'HDFCBANK.NS', n: 'HDFC Bank', sec: 'Financial Services', ind: 'Banks', cap: 12 },
  ];
  it('prefers the same industry, then the same sector, largest first', () => {
    expect(findPeers('TCS.NS', u).map((e) => e.s)).toEqual(['INFY.NS', 'WIPRO.NS', 'TATAELXSI.NS']);
  });
  it('matches a BSE listing through its NSE twin', () => {
    expect(findPeers('TCS.BO', u)[0].s).toBe('INFY.NS');
  });
  it('returns nothing for symbols outside the index', () => {
    expect(findPeers('XYZ.NS', u)).toEqual([]);
  });
});
