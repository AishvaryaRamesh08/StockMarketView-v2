import { describe, expect, it } from 'vitest';
import { breadth, changeColor, findPeers, parseRgbTriple, sectors, topMovers } from './pulse.ts';
import { squarify } from './treemap.ts';
import type { PulseStock, UniverseEntry } from './marketData.ts';

const st = (s: string, chg: number, p = 100, v = 1000, sec = 'Tech', cap = 1e9): PulseStock => ({ s, n: s, sec, p, chg, v, t: p * v, cap });

describe('squarify', () => {
  const rect = { x: 0, y: 0, w: 400, h: 300 };
  it('tiles fill the rectangle with areas proportional to value', () => {
    const tiles = squarify([6, 6, 4, 3, 2, 2, 1], (v) => v, rect);
    const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
    expect(area).toBeCloseTo(400 * 300, 6);
    const total = 24;
    for (const t of tiles) expect((t.w * t.h) / (400 * 300)).toBeCloseTo(t.item / total, 6);
  });
  it('keeps every tile inside the rectangle', () => {
    for (const t of squarify([5, 1, 1, 1, 9, 2], (v) => v, rect)) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(400 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(300 + 1e-9);
    }
  });
  it('produces reasonably square tiles', () => {
    const tiles = squarify(Array.from({ length: 20 }, () => 1), (v) => v, rect);
    for (const t of tiles) expect(Math.max(t.w / t.h, t.h / t.w)).toBeLessThan(3);
  });
  it('ignores zero values and empty input', () => {
    expect(squarify([0, 0], (v) => v, rect)).toEqual([]);
    expect(squarify([3, 0], (v) => v, rect)).toHaveLength(1);
  });
});

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

describe('sectors', () => {
  it('weights sector change by market cap and sorts by size', () => {
    const s = sectors([st('A', 2, 1, 1, 'Tech', 3e9), st('B', -2, 1, 1, 'Tech', 1e9), st('C', 1, 1, 1, 'Energy', 1e9)]);
    expect(s[0].name).toBe('Tech');
    expect(s[0].chg).toBeCloseTo(1, 10);
  });
});

describe('changeColor', () => {
  it('is neutral at zero and saturates beyond ±3%', () => {
    expect(changeColor(0)).toBe('rgb(52, 58, 72)');
    expect(changeColor(5)).toBe(changeColor(3));
    expect(changeColor(-5)).toBe(changeColor(-3));
  });
  it('uses a custom scheme, read from CSS variables', () => {
    const scheme = { neutral: [0, 0, 0], up: parseRgbTriple(' 10, 20,30 ', [1, 1, 1]), down: [9, 9, 9] };
    expect(changeColor(3, scheme)).toBe('rgb(10, 20, 30)');
    expect(parseRgbTriple('nonsense', [1, 2, 3])).toEqual([1, 2, 3]);
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
