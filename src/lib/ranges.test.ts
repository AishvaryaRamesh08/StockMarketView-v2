import { describe, expect, it } from 'vitest';
import { INTERVALS, PERIODS, defaultInterval, intervalForPeriod, periodForInterval, pollRange, unsupportedReason } from './ranges.ts';

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
