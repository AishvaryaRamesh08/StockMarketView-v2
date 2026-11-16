import { describe, expect, it } from 'vitest';
import { formatCountdown, marketOf, marketStatus, zonedTime } from './markets.ts';

const utc = (iso: string) => new Date(iso);

describe('zonedTime', () => {
  it('converts IST wall time to UTC', () => {
    expect(zonedTime('Asia/Kolkata', '2026-11-16', '09:15').toISOString()).toBe('2026-11-16T03:45:00.000Z');
  });
  it('handles US daylight saving on both sides of the switch', () => {
    // DST starts 2026-03-08 and ends 2026-11-01.
    expect(zonedTime('America/New_York', '2026-03-06', '09:30').toISOString()).toBe('2026-03-06T14:30:00.000Z');
    expect(zonedTime('America/New_York', '2026-03-09', '09:30').toISOString()).toBe('2026-03-09T13:30:00.000Z');
    expect(zonedTime('America/New_York', '2026-10-30', '09:30').toISOString()).toBe('2026-10-30T13:30:00.000Z');
    expect(zonedTime('America/New_York', '2026-11-02', '09:30').toISOString()).toBe('2026-11-02T14:30:00.000Z');
  });
});

describe('India market status', () => {
  it('is open during the session and counts down to 15:30 IST', () => {
    const s = marketStatus('IN', utc('2026-11-16T05:00:00Z')); // 10:30 IST Monday
    expect(s.state).toBe('open');
    expect(s.nextLabel).toBe('Closes');
    expect(s.next.toISOString()).toBe('2026-11-16T10:00:00.000Z');
  });
  it('is in pre-open between 09:00 and 09:15', () => {
    expect(marketStatus('IN', utc('2026-11-16T03:35:00Z')).state).toBe('pre-open');
  });
  it('is closed after the close and opens next weekday', () => {
    const s = marketStatus('IN', utc('2026-11-16T11:00:00Z')); // 16:30 IST
    expect(s.state).toBe('closed');
    expect(s.next.toISOString()).toBe('2026-11-17T03:45:00.000Z');
  });
  it('skips the weekend', () => {
    const s = marketStatus('IN', utc('2026-11-20T12:00:00Z')); // Friday evening
    expect(s.next.toISOString()).toBe('2026-11-23T03:45:00.000Z'); // Monday 09:15 IST
  });
  it('reports a holiday by name and skips it', () => {
    const s = marketStatus('IN', utc('2026-11-24T05:00:00Z')); // Guru Nanak Jayanti
    expect(s.state).toBe('holiday');
    expect(s.label).toBe('Guru Nanak Jayanti');
    expect(s.next.toISOString()).toBe('2026-11-25T03:45:00.000Z');
  });
  it('skips a holiday when computing the next open from the evening before', () => {
    const s = marketStatus('IN', utc('2026-11-23T12:00:00Z'));
    expect(s.next.toISOString()).toBe('2026-11-25T03:45:00.000Z');
  });
});

describe('US market status', () => {
  it('is open at 10:00 ET', () => {
    expect(marketStatus('US', utc('2026-11-16T15:00:00Z')).state).toBe('open');
  });
  it('is pre-market at 08:00 ET', () => {
    const s = marketStatus('US', utc('2026-11-16T13:00:00Z'));
    expect(s.state).toBe('pre-open');
    expect(s.label).toBe('Pre-market');
    expect(s.next.toISOString()).toBe('2026-11-16T14:30:00.000Z');
  });
  it('is closed on Thanksgiving and reopens Friday', () => {
    const s = marketStatus('US', utc('2026-11-26T16:00:00Z'));
    expect(s.state).toBe('holiday');
    expect(s.next.toISOString()).toBe('2026-11-27T14:30:00.000Z');
  });
  it('closes early at 13:00 ET the day after Thanksgiving', () => {
    const open = marketStatus('US', utc('2026-11-27T17:00:00Z')); // 12:00 ET
    expect(open.state).toBe('open');
    expect(open.earlyClose).toBe('13:00');
    expect(open.next.toISOString()).toBe('2026-11-27T18:00:00.000Z');
    expect(marketStatus('US', utc('2026-11-27T18:30:00Z')).state).toBe('closed'); // 13:30 ET
  });
  it('is closed overnight with the next open in the morning', () => {
    const s = marketStatus('US', utc('2026-11-17T02:00:00Z')); // 21:00 ET Monday
    expect(s.state).toBe('closed');
    expect(s.next.toISOString()).toBe('2026-11-17T14:30:00.000Z');
  });
});

describe('marketOf', () => {
  it('maps Yahoo symbols to markets', () => {
    expect(marketOf('RELIANCE.NS')).toBe('IN');
    expect(marketOf('500325.BO')).toBe('IN');
    expect(marketOf('^NSEI')).toBe('IN');
    expect(marketOf('^BSESN')).toBe('IN');
    expect(marketOf('AAPL')).toBe('US');
    expect(marketOf('BRK-B')).toBe('US');
    expect(marketOf('^GSPC')).toBe('US');
  });
});

describe('formatCountdown', () => {
  it('formats durations', () => {
    expect(formatCountdown(65_000)).toBe('1m 05s');
    expect(formatCountdown(2 * 3600_000 + 5 * 60_000)).toBe('2h 05m');
    expect(formatCountdown(3 * 86400_000 + 4 * 3600_000)).toBe('3d 4h');
    expect(formatCountdown(-5)).toBe('0m 00s');
  });
});
