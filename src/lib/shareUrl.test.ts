import { describe, expect, it } from 'vitest';
import { decodeLink, encodeLink } from './shareUrl.ts';

describe('share links', () => {
  it('round-trips a chart', () => {
    const state = { view: 'chart' as const, symbol: 'RELIANCE.NS', period: '6mo' as const, interval: '1d' as const, overlays: ['sma50' as const, 'rsi' as const], compare: ['TCS.NS', '^NSEI'], layout: 'single' as const };
    const qs = encodeLink(state);
    expect(qs).toBe('s=RELIANCE.NS&p=6mo&i=1d&o=sma50,rsi&c=TCS.NS,^NSEI');
    expect(decodeLink(`?${qs}`)).toEqual(state);
  });
  it('round-trips the multi-timeframe layout and an empty indicator list', () => {
    const qs = encodeLink({ view: 'chart', symbol: 'AAPL', period: '1y', interval: '1d', overlays: [], layout: 'multi' });
    expect(qs).toBe('s=AAPL&p=1y&i=1d&o=&l=multi');
    expect(decodeLink(qs)).toMatchObject({ symbol: 'AAPL', overlays: [], layout: 'multi' });
  });
  it('encodes the markets page', () => {
    expect(encodeLink({ view: 'markets', market: 'US' })).toBe('v=markets&m=US');
    expect(decodeLink('?v=markets&m=US')).toEqual({ view: 'markets', market: 'US' });
    expect(decodeLink('?v=markets&m=XX')).toEqual({ view: 'markets', market: undefined });
  });
  it('returns null for a plain visit so the visitor keeps their own session', () => {
    expect(decodeLink('')).toBeNull();
    expect(decodeLink('?utm_source=x')).toBeNull();
  });
  it('drops anything invalid instead of trusting it', () => {
    expect(decodeLink('?s=<script>')).toBeNull();
    const d = decodeLink('?s=AAPL&p=2y&i=3h&o=sma50,bogus,sma50&c=MSFT,AAPL,a%20b,GOOG,AMZN,META,NVDA');
    expect(d).toEqual({ view: 'chart', symbol: 'AAPL', overlays: ['sma50'], compare: ['MSFT', 'GOOG', 'AMZN', 'META'], layout: 'single' });
  });
  it('leaves indicators unchanged when the link does not mention them', () => {
    expect(decodeLink('?s=AAPL')?.overlays).toBeUndefined();
  });
});
