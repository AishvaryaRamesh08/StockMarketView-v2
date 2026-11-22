import { describe, expect, it } from 'vitest';
import { INTERVALS, PERIODS, defaultInterval, intervalForPeriod, periodForInterval, pollRange, reachedListing, stepBack, unsupportedReason, type IntervalId, type PeriodId } from './ranges.ts';

describe('period/interval rules', () => {
  it('every period has a default interval that it supports', () => {
    for (const p of PERIODS) expect(unsupportedReason(p.id, defaultInterval(p.id))).toBeNull();
  });
  it('every interval is usable with at least one period', () => {
    for (const i of INTERVALS) expect(PERIODS.some((p) => unsupportedReason(p.id, i.id) === null)).toBe(true);
  });
  it('blocks combinations Yahoo cannot serve', () => {
    expect(unsupportedReason('1mo', '1m')).not.toBeNull();
    expect(unsupportedReason('3mo', '5m')).not.toBeNull();
    expect(unsupportedReason('5y', '60m')).not.toBeNull();
    expect(unsupportedReason('1d', '1d')).not.toBeNull();
    expect(unsupportedReason('1mo', '1mo')).not.toBeNull();
  });
  it('allows the common ones', () => {
    expect(unsupportedReason('1d', '1m')).toBeNull();
    expect(unsupportedReason('5d', '1m')).toBeNull();
    expect(unsupportedReason('1mo', '15m')).toBeNull();
    expect(unsupportedReason('1y', '60m')).toBeNull();
    expect(unsupportedReason('max', '1d')).toBeNull();
  });
  it('sizes YTD by the date', () => {
    expect(unsupportedReason('ytd', '15m', new Date('2026-01-20T00:00:00Z'))).toBeNull();
    expect(unsupportedReason('ytd', '15m', new Date('2026-11-16T00:00:00Z'))).not.toBeNull();
    expect(unsupportedReason('ytd', '1wk', new Date('2026-01-20T00:00:00Z'))).not.toBeNull();
  });
  it('keeps a still-valid interval when the period changes', () => {
    expect(intervalForPeriod('1y', '1d')).toBe('1d');
    expect(intervalForPeriod('5y', '60m')).toBe('1wk');
  });
  it('moves the period to the nearest one that fits a new interval', () => {
    expect(periodForInterval('1m', '6mo')).toBe('5d');
    expect(periodForInterval('1mo', '6mo')).toBe('1y');
    expect(periodForInterval('1d', '6mo')).toBe('6mo');
  });
  it('polls a short range for refreshes', () => {
    expect(pollRange('5m')).toBe('1d');
    expect(pollRange('1d')).toBe('5d');
    expect(pollRange('1wk')).toBe('1mo');
    expect(pollRange('1mo')).toBe('3mo');
  });
});

describe('stepBack', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const walk = (p: PeriodId, i: IntervalId) => {
    const out: string[] = [];
    let s: { period: PeriodId; interval: IntervalId } | null = { period: p, interval: i };
    while ((s = stepBack(s.period, s.interval, now))) out.push(`${s.period}/${s.interval}`);
    return out;
  };
  it('walks a 1-day intraday chart back to Max, coarsening the interval only when it must', () => {
    expect(walk('1d', '5m')).toEqual(['5d/5m', '1mo/5m', '3mo/60m', '6mo/60m', '1y/60m', '5y/1d', '10y/1d', 'max/1wk']);
  });
  it('moves off 1-minute candles once they would be too many or unavailable', () => {
    expect(walk('1d', '1m').slice(0, 3)).toEqual(['5d/1m', '1mo/5m', '3mo/60m']);
  });
  it('keeps daily candles from 6 months back, and treats YTD like 6M', () => {
    expect(walk('6mo', '1d')).toEqual(['1y/1d', '5y/1d', '10y/1d', 'max/1wk']);
    expect(stepBack('ytd', '1d', now)).toEqual({ period: '1y', interval: '1d' });
  });
  it('stops at Max', () => {
    expect(stepBack('max', '1mo', now)).toBeNull();
  });
});

describe('reachedListing', () => {
  const now = Date.UTC(2026, 10, 20);
  it('is true when a 5-year chart starts only 2 years ago (a recent listing)', () => {
    expect(reachedListing('5y', now / 1000 - 2 * 365 * 86400, now)).toBe(true);
    expect(reachedListing('5y', now / 1000 - 1825 * 86400, now)).toBe(false);
  });
  it('never blocks short intraday periods', () => {
    expect(reachedListing('5d', now / 1000 - 86400, now)).toBe(false);
  });
});
