import { describe, expect, it } from 'vitest';
import { availableYears, fixedDeposit, lumpSum, monthlyDates, planDates, sip, startIndex, xirr } from './whatIf.ts';
import type { Candle } from './types.ts';

const DAY = 86400;
const YEAR = 365.25 * DAY;
const T0 = Date.UTC(2020, 0, 1) / 1000;
/** One candle a day; price grows linearly from 100. */
function series(days: number, step = 0.1): Candle[] {
  return Array.from({ length: days }, (_, i) => {
    const c = 100 + i * step;
    return { t: T0 + i * DAY, o: c, h: c, l: c, c, v: 1 };
  });
}

describe('lump sum', () => {
  it('buys at the first close on or after the start date and values at the last close', () => {
    const cs = series(731);
    const r = lumpSum(cs, T0 - 5 * DAY, 10_000)!;
    expect(r.startT).toBe(T0);
    expect(r.value).toBeCloseTo((10_000 / 100) * cs[730].c, 6);
    expect(r.gainPct).toBeCloseTo(73, 6);
    expect(r.annualPct).toBeCloseTo((Math.pow(1.73, YEAR / (730 * DAY)) - 1) * 100, 6);
  });
  it('returns nothing for a start after the last candle', () => {
    expect(lumpSum(series(10), T0 + 100 * DAY, 1000)).toBeNull();
  });
});

describe('SIP', () => {
  it('invests on the first trading day of each month', () => {
    const cs = series(100);
    expect(monthlyDates(cs, T0).map((i) => new Date(cs[i].t * 1000).toISOString().slice(0, 10))).toEqual(['2020-01-01', '2020-02-01', '2020-03-01', '2020-04-01']);
  });
  it('adds up units, invested amount and value', () => {
    const cs = series(100);
    const r = sip(cs, T0, 1000)!;
    expect(r.installments).toBe(4);
    expect(r.invested).toBe(4000);
    const units = [0, 31, 60, 91].reduce((a, i) => a + 1000 / cs[i].c, 0);
    expect(r.value).toBeCloseTo(units * cs[99].c, 6);
    expect(r.series[r.series.length - 1].invested).toBe(4000);
  });
  it('a flat price gives a zero return', () => {
    const r = sip(series(400, 0), T0, 500)!;
    expect(r.gain).toBeCloseTo(0, 6);
    expect(r.annualPct!).toBeCloseTo(0, 3);
  });
});

describe('xirr and fixed deposit', () => {
  it('finds 10% for money that grows 10% in a year', () => {
    expect(xirr([{ t: 0, amount: -100 }, { t: YEAR, amount: 110 }])!).toBeCloseTo(10, 4);
  });
  it('agrees with a fixed deposit run through the same formula', () => {
    const fd = fixedDeposit([0], 1000, 2 * YEAR, 8);
    expect(fd.value).toBeCloseTo(1000 * Math.pow(1.02, 8), 6);
    expect(xirr([{ t: 0, amount: -1000 }, { t: 2 * YEAR, amount: fd.value }])!).toBeCloseTo((Math.pow(1.02, 4) - 1) * 100, 3);
  });
  it('plans the same dates for the comparison', () => {
    const cs = series(70);
    expect(planDates('lump', cs, T0)).toEqual([T0]);
    expect(planDates('sip', cs, T0)).toHaveLength(3);
    expect(startIndex(cs, T0 + 0.5 * DAY)).toBe(1);
  });
});

describe('available years', () => {
  it('counts a 10-year download that ends just short of ten years as ten (the 10Y button)', () => {
    // Real INFY.NS range=10y: 18 Nov 2016 to 18 Nov 2026, 9.999 years.
    const first = Date.UTC(2016, 10, 18, 3, 45) / 1000;
    const last = Date.UTC(2026, 10, 18, 3, 45) / 1000;
    expect(availableYears(first, last)).toBe(10);
    expect(availableYears(first + 10 * DAY, last)).toBe(10);
  });
  it('does not round a stock listed 9.5 years ago up to ten', () => {
    expect(availableYears(0, 9.5 * YEAR)).toBe(9);
  });
});
