import { describe, expect, it } from 'vitest';
import { badgesFromFeeds } from './useWatchlistBadges.ts';
import type { PatternFeed } from '../lib/marketData.ts';

const feed = (market: 'IN' | 'US', hits: Array<[string, string, 'bullish' | 'bearish' | 'neutral']>): PatternFeed =>
  ({ market, session: '2026-11-17', generatedAt: '', scanned: 500, hits: hits.map(([s, p, b]) => ({ s, n: s, sec: '', p, b, c: 1, chg: 0, vr: null, rsi: null })) }) as PatternFeed;

describe('watchlist badges from the daily scan', () => {
  it('matches symbols, maps BSE to NSE, and skips doji', () => {
    const b = badgesFromFeeds(['RELIANCE.BO', 'TCS.NS', 'AAPL', 'SPY'], [
      feed('IN', [
        ['RELIANCE.NS', 'bullishEngulfing', 'bullish'],
        ['TCS.NS', 'doji', 'neutral'],
      ]),
      feed('US', [['AAPL', 'shootingStar', 'bearish']]),
    ]);
    expect(b).toEqual({ 'RELIANCE.BO': { pattern: 'bullishEngulfing', bias: 'bullish' }, AAPL: { pattern: 'shootingStar', bias: 'bearish' } });
  });
});
