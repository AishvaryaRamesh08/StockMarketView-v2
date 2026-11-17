import { describe, expect, it } from 'vitest';
import { trackRecord, verdict } from './patternStats.ts';
import { detectPatterns } from './patterns.ts';
import type { Candle } from './types.ts';

let t = 0;
const bar = (o: number, h: number, l: number, c: number): Candle => ({ t: (t += 86400), o, h, l, c, v: 1000 });
const decline = (from: number) => [0, 1, 2, 3, 4].map((k) => bar(from - 2 * k, from - 2 * k + 1, from - 2 * k - 2.5, from - 2 * k - 2));
const flat = (p: number, n: number) => Array.from({ length: n }, () => bar(p, p + 1, p - 1, p + 0.01));

/** A decline, a bullish engulfing, then `after` closes. */
function episode(after: number[]): Candle[] {
  const d = decline(120);
  const c = [...d, bar(108, 108.5, 104, 104.5), bar(104, 109.5, 103.5, 109)];
  for (const p of after) c.push(bar(p, p + 0.6, p - 0.6, p + 0.2));
  return c;
}

describe('trackRecord', () => {
  it('scores each occurrence by the close N candles later', () => {
    t = 0;
    const candles = [...episode([110, 111, 112, 113, 115]), ...episode([108, 107, 106, 105, 104]), ...flat(100, 3)];
    const hits = detectPatterns(candles).filter((h) => h.pattern === 'bullishEngulfing');
    expect(hits).toHaveLength(2);
    const r = trackRecord(candles, 5).records.find((x) => x.pattern === 'bullishEngulfing')!;
    expect(r.count).toBe(2);
    expect(r.workedPct).toBe(50);
    // Entry at 109: +5.69% (115.2) and −4.40% (104.2).
    expect(r.bestReturnPct).toBeCloseTo((115.2 / 109 - 1) * 100, 6);
    expect(r.worstReturnPct).toBeCloseTo((104.2 / 109 - 1) * 100, 6);
    expect(r.lastSeen).toBe(hits[1].t);
  });
  it('leaves out occurrences too recent to score, but still reports when last seen', () => {
    t = 0;
    const candles = episode([110, 111]);
    const r = trackRecord(candles, 5).records.find((x) => x.pattern === 'bullishEngulfing')!;
    expect(r.count).toBe(0);
    expect(r.workedPct).toBeNull();
    expect(r.lastSeen).not.toBeNull();
  });
  it('reports the base rate of all N-candle windows', () => {
    t = 0;
    const up = Array.from({ length: 20 }, (_, i) => bar(100 + i, 101 + i, 99 + i, 100.5 + i));
    const tr = trackRecord(up, 5);
    expect(tr.baseUpPct).toBe(100);
    expect(tr.candles).toBe(20);
  });
});

describe('verdict', () => {
  const tr = { horizon: 5, baseUpPct: 55, baseAvgPct: 0.3, years: 10, candles: 2500, records: [] };
  const rec = (bias: 'bullish' | 'bearish', count: number, workedPct: number) => ({ pattern: 'hammer' as const, bias, count, workedPct, avgReturnPct: 0, medianReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0, lastSeen: 0 });
  it('compares with the base rate, flipped for bearish patterns', () => {
    expect(verdict(rec('bullish', 20, 65), tr)).toBe('better');
    expect(verdict(rec('bullish', 20, 56), tr)).toBe('similar');
    expect(verdict(rec('bearish', 20, 52), tr)).toBe('better');
    expect(verdict(rec('bearish', 20, 30), tr)).toBe('worse');
  });
  it('refuses to judge from a handful of cases', () => {
    expect(verdict(rec('bullish', 5, 100), tr)).toBe('too few');
  });
});
