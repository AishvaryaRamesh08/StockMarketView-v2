import { describe, expect, it } from 'vitest';
import { atr, bollinger, ema, ichimoku, lastValue, macd, parabolicSar, rsi, sma, vwap } from './indicators.ts';
import type { Candle } from './types.ts';

const bar = (t: number, o: number, h: number, l: number, c: number, v = 100): Candle => ({ t, o, h, l, c, v });
const trend = (n: number, start: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return bar(i * 86400, c - step / 2, c + 1, c - 1 - Math.abs(step), c);
  });

describe('sma / ema', () => {
  it('computes a simple moving average with warm-up nulls', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('seeds the EMA with the SMA and then smooths', () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBe(3); // 4*0.5 + 2*0.5
    expect(e[4]).toBe(4);
  });
  it('skips leading nulls when smoothing another series', () => {
    expect(ema([null, null, 2, 4, 6], 2)).toEqual([null, null, null, 3, 5]);
  });
});

describe('rsi', () => {
  // Wilder's worked example data from StockCharts (RSI 14). Exact arithmetic gives
  // avg gain 3.34/14, avg loss 1.40/14 → RSI 70.46; StockCharts shows 70.53 because it rounds
  // the intermediate averages. We assert the exact values.
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  it('matches the hand-computed reference values', () => {
    const r = rsi(closes, 14);
    expect(r.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(r[14]).toBeCloseTo(100 - 100 / (1 + 3.34 / 1.4), 6);
    // Next bar: change −0.28 → gain 3.34/14·13/14, loss (1.4/14·13 + 0.28)/14.
    const g = ((3.34 / 14) * 13) / 14;
    const l = ((1.4 / 14) * 13 + 0.28) / 14;
    expect(r[15]).toBeCloseTo(100 - 100 / (1 + g / l), 6);
  });
  it('is 100 when price only rises', () => {
    expect(lastValue(rsi([1, 2, 3, 4, 5, 6], 3))).toBe(100);
  });
});

describe('bollinger', () => {
  it('collapses to the average on a flat series', () => {
    const b = bollinger([5, 5, 5, 5], 3);
    expect(b.upper[3]).toBe(5);
    expect(b.lower[3]).toBe(5);
  });
  it('uses the population standard deviation', () => {
    const b = bollinger([1, 2, 3], 3, 2);
    // mean 2, population sd sqrt(2/3)
    expect(b.upper[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 10);
  });
});

describe('macd', () => {
  it('histogram is the gap between MACD and its signal', () => {
    const closes = trend(60, 100, 1).map((c) => c.c + Math.sin(c.t));
    const m = macd(closes);
    const i = closes.length - 1;
    expect(m.histogram[i]).toBeCloseTo(m.macd[i]! - m.signal[i]!, 10);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).not.toBeNull();
  });
  it('is positive in a steady uptrend', () => {
    expect(lastValue(macd(trend(60, 100, 1).map((c) => c.c)).macd)!).toBeGreaterThan(0);
  });
});

describe('vwap', () => {
  it('weights by volume and resets each session', () => {
    const candles = [bar(0, 10, 10, 10, 10, 100), bar(60, 20, 20, 20, 20, 300), bar(86400, 50, 50, 50, 50, 10)];
    const v = vwap(candles, (t) => String(Math.floor(t / 86400)));
    expect(v[1]).toBe(17.5);
    expect(v[2]).toBe(50);
  });
});

describe('parabolic SAR', () => {
  it('stays below price in an uptrend and flips above after a crash', () => {
    const up = trend(30, 100, 1);
    const s = parabolicSar(up);
    for (let i = 2; i < up.length; i++) expect(s[i]!).toBeLessThanOrEqual(up[i].l);
    const crash = [...up, bar(30 * 86400, 120, 121, 90, 91)];
    const s2 = parabolicSar(crash);
    expect(s2.at(-1)!).toBeGreaterThan(crash.at(-1)!.h);
  });
});

describe('ichimoku', () => {
  it('projects the senkou spans 26 bars ahead', () => {
    const candles = trend(80, 100, 1);
    const ich = ichimoku(candles);
    expect(ich.senkouA).toHaveLength(80 + 26);
    // Span A needs the 26-bar kijun (first at index 25); span B needs 52 bars (first at 51).
    expect(ich.senkouA[24 + 26]).toBeNull();
    expect(ich.senkouA[25 + 26]).not.toBeNull();
    expect(ich.senkouB[50 + 26]).toBeNull();
    expect(ich.senkouB[51 + 26]).not.toBeNull();
    expect(ich.chikou[0]).toBe(candles[26].c);
  });
});

describe('atr', () => {
  it('equals the bar range on constant bars', () => {
    const candles = Array.from({ length: 20 }, (_, i) => bar(i, 10, 12, 8, 10));
    expect(lastValue(atr(candles, 14))).toBeCloseTo(4, 10);
  });
});
