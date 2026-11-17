import { describe, expect, it } from 'vitest';
import { fitRange, periodFor, resolveTicker, systemPrompt, toInterval, toOverlay, toPeriod, TOOLS } from './chatTools.ts';
import { toEntry } from './search.ts';
import { unsupportedReason, INTERVALS } from './ranges.ts';

const entries = [
  ['RELIANCE.NS', 'Reliance Industries Limited', 'NSE', 's'],
  ['RELIANCE.BO', 'Reliance Industries Limited', 'BSE', 's'],
  ['AAPL', 'Apple Inc.', 'NASDAQ', 's'],
  ['TCS.NS', 'Tata Consultancy Services Limited', 'NSE', 's'],
  ['^NSEI', 'NIFTY 50', 'NSE', 'i'],
].map((r) => toEntry(r as [string, string, string, 's' | 'e' | 'i']));

describe('tool declarations', () => {
  it('cover every tool in the spec', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(['add_overlay', 'add_to_watchlist', 'compare', 'get_chart_summary', 'get_quote', 'open_markets', 'remove_overlay', 'set_multi_timeframe', 'show_chart'].sort());
  });
  it('offer no way to place trades', () => {
    expect(TOOLS.some((t) => /trade|order|buy|sell/i.test(t.name))).toBe(false);
  });
});

describe('argument clean-up', () => {
  it('accepts common spellings of periods and intervals', () => {
    expect(toPeriod('1Y')).toBe('1y');
    expect(toPeriod('year')).toBe('1y');
    expect(toPeriod('bogus')).toBeNull();
    expect(toInterval('1h')).toBe('60m');
    expect(toInterval('daily')).toBe('1d');
    expect(toInterval('weekly')).toBe('1wk');
  });
  it('matches overlays by id, label or a close variant', () => {
    expect(toOverlay('rsi')).toBe('rsi');
    expect(toOverlay('RSI 14')).toBe('rsi');
    expect(toOverlay('Bollinger Bands')).toBe('bb');
    expect(toOverlay('bollinger')).toBe('bb');
    expect(toOverlay('SMA 50')).toBe('sma50');
    expect(toOverlay('bullish engulfing')).toBe('bullishEngulfing');
    expect(toOverlay('astrology')).toBeNull();
  });
  it('fixes period/interval pairs the data source cannot serve', () => {
    const r = fitRange('5y', '5m', true);
    expect(unsupportedReason(r.period, r.interval)).toBeNull();
    expect(r.interval).toBe('5m');
    expect(r.adjusted).toBeTruthy();
    const r2 = fitRange('5y', '5m', false);
    expect(r2.period).toBe('5y');
    expect(unsupportedReason(r2.period, r2.interval)).toBeNull();
    expect(fitRange('1y', '1d', false)).toEqual({ period: '1y', interval: '1d' });
  });
  it('gives every interval a period it can serve, for multi-timeframe frames', () => {
    for (const i of INTERVALS) expect(unsupportedReason(periodFor(i.id), i.id)).toBeNull();
  });
  it('resolves names and tickers, preferring NSE for Indian stocks', () => {
    expect(resolveTicker(entries, 'Reliance')?.symbol).toBe('RELIANCE.NS');
    expect(resolveTicker(entries, 'reliance.bo')?.symbol).toBe('RELIANCE.BO');
    expect(resolveTicker(entries, 'apple')?.symbol).toBe('AAPL');
    expect(resolveTicker(entries, 'Nifty 50')?.symbol).toBe('^NSEI');
    expect(resolveTicker(entries, 'zzzz')).toBeNull();
  });
});

describe('system prompt', () => {
  const p = systemPrompt({
    now: new Date('2026-11-17T10:00:00Z'),
    view: 'chart',
    symbol: 'WFC',
    name: 'Wells Fargo',
    period: 'ytd',
    interval: '1d',
    overlays: ['sma50'],
    compare: [],
    layout: 'single',
    marketState: { IN: 'Closed', US: 'Open' },
  });
  it('states the limits and the current screen', () => {
    expect(p).toMatch(/Never recommend buying, selling or holding/);
    expect(p).toMatch(/cannot place trades/);
    expect(p).toMatch(/Wells Fargo \(WFC\)/);
    expect(p).toMatch(/demat/);
    expect(p).toMatch(/2026-11-17/);
  });
});
