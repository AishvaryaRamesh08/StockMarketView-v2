import { useMemo } from 'react';
import { usePatternFeed } from './useMarketData.ts';
import { marketOf } from '../lib/markets.ts';
import type { PatternFeed } from '../lib/marketData.ts';
import type { Bias, PatternId } from '../lib/patterns.ts';

export interface Badge {
  pattern: PatternId;
  bias: Bias;
}

/**
 * Pattern badges for watchlist rows, read from the daily pattern scan (one cached request per
 * market) instead of one chart request per stock. Covers NIFTY 500 and S&P 500 stocks; a BSE
 * symbol uses its NSE twin. Doji are left out: they say "undecided", not "watch this".
 */
export function badgesFromFeeds(symbols: string[], feeds: Array<PatternFeed | null>): Record<string, Badge> {
  const hits = new Map<string, Badge>();
  for (const f of feeds) for (const h of f?.hits ?? []) if (h.p !== 'doji' && !hits.has(h.s)) hits.set(h.s, { pattern: h.p, bias: h.b });
  const out: Record<string, Badge> = {};
  for (const s of symbols) {
    const b = hits.get(s) ?? hits.get(s.replace(/\.BO$/, '.NS'));
    if (b) out[s] = b;
  }
  return out;
}

export function useWatchlistBadges(symbols: string[]): Record<string, Badge> {
  const hasIN = symbols.some((s) => marketOf(s) === 'IN' && !s.startsWith('^'));
  const hasUS = symbols.some((s) => marketOf(s) === 'US' && !s.startsWith('^'));
  const inFeed = usePatternFeed('IN', hasIN).feed;
  const usFeed = usePatternFeed('US', hasUS).feed;
  const key = symbols.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => badgesFromFeeds(symbols, [inFeed, usFeed]), [key, inFeed, usFeed]);
}
