import { describe, expect, it } from 'vitest';
import { previousSession, supportResistance, swingPoints } from './levels.ts';
import { summarize } from './summary.ts';
import type { Candle } from './types.ts';

const bar = (t: number, c: number, spread = 1): Candle => ({ t, o: c, h: c + spread, l: c - spread, c, v: 100 });

describe('previousSession', () => {
  it('uses the second-to-last bar for daily candles', () => {
    expect(previousSession([bar(0, 10), bar(1, 20), bar(2, 30)], false, String)).toEqual({ high: 21, low: 19 });
  });
  it('groups intraday bars by session', () => {
    const day = (d: number, h: number) => d * 86400 + h * 3600;
    const candles = [bar(day(0, 10), 50), bar(day(1, 10), 100), bar(day(1, 11), 110), bar(day(1, 12), 90), bar(day(2, 10), 105)];
    const sessionOf = (t: number) => String(Math.floor(t / 86400));
    expect(previousSession(candles, true, sessionOf)).toEqual({ high: 111, low: 89 });
  });
});

describe('swingPoints', () => {
  it('finds a peak and a trough', () => {
    const closes = [10, 11, 12, 15, 12, 11, 10, 8, 5, 8, 10, 11];
    const { highs, lows } = swingPoints(closes.map((c, i) => bar(i, c)), 3);
    expect(highs).toContain(3);
    expect(lows).toContain(8);
  });
});

describe('supportResistance', () => {
  it('finds a level price has turned at more than once', () => {
    // A range: peaks near 120, troughs near 100, ending at 110.
    const wave = [100, 105, 110, 115, 120, 115, 110, 105];
    const closes = [...wave, ...wave, ...wave, ...wave, 100, 105, 110];
    const levels = supportResistance(closes.map((c, i) => bar(i, c)));
    const res = levels.find((l) => l.kind === 'resistance');
    const sup = levels.find((l) => l.kind === 'support');
    expect(res?.price).toBeCloseTo(121, 0);
    expect(sup?.price).toBeCloseTo(99, 0);
    expect(res!.touches!).toBeGreaterThanOrEqual(2);
  });
  it('returns nothing on too little data', () => {
    expect(supportResistance([bar(0, 1), bar(1, 2)])).toEqual([]);
  });
});

describe('summarize', () => {
  const uptrend = Array.from({ length: 80 }, (_, i) => bar(i * 86400, 100 + i + (i % 3)));
  it('describes trend and RSI in plain words', () => {
    const parts = summarize(uptrend, '1d');
    expect(parts[0]).toMatchObject({ text: 'Above 50-day average', tone: 'bullish' });
    expect(parts.some((p) => p.text.startsWith('RSI '))).toBe(true);
  });
  it('uses candle wording on intraday intervals', () => {
    expect(summarize(uptrend, '5m')[0].text).toBe('Above 50-candle average');
  });
  it('flags a stock near its 52-week high', () => {
    expect(summarize(uptrend, '1d', 182).some((p) => p.text === 'Near 52-week high')).toBe(true);
  });
  it('says nothing with too little data', () => {
    expect(summarize(uptrend.slice(0, 10), '1d')).toEqual([]);
  });
});
