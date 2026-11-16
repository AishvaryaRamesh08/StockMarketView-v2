import { useEffect, useState } from 'react';
import { fetchChart } from '../lib/api.ts';
import { detectPatterns, type PatternHit } from '../lib/patterns.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import { useNow } from './useNow.ts';

interface Entry {
  hit: PatternHit | null;
  at: number;
}

const cache = new Map<string, Entry>();
const TTL = 10 * 60_000;

/**
 * The most recent candlestick pattern on each symbol's last two completed daily candles, for
 * watchlist badges. One small request per symbol, at most every 10 minutes, 4 at a time.
 */
export function useDailyPatterns(symbols: string[]): Record<string, PatternHit | null> {
  const [result, setResult] = useState<Record<string, PatternHit | null>>(() => Object.fromEntries(symbols.filter((s) => cache.has(s)).map((s) => [s, cache.get(s)!.hit])));
  const key = symbols.join(',');
  // Re-check every 10 minutes; the effect below only refetches entries older than the TTL.
  const tick = useNow(TTL);

  useEffect(() => {
    let cancelled = false;
    const c = new AbortController();
    const due = symbols.filter((s) => !cache.has(s) || Date.now() - cache.get(s)!.at > TTL);
    setResult(Object.fromEntries(symbols.filter((s) => cache.has(s)).map((s) => [s, cache.get(s)!.hit])));

    const queue = [...due];
    const worker = async () => {
      while (queue.length && !cancelled) {
        const s = queue.shift()!;
        try {
          const res = await fetchChart(s, '1mo', '1d', c.signal);
          // Ignore today's still-forming candle while the market is open.
          const live = marketStatus(marketOf(s)).state === 'open';
          const candles = live ? res.candles.slice(0, -1) : res.candles;
          const hits = detectPatterns(candles).filter((h) => h.index >= candles.length - 2 && h.pattern !== 'doji');
          const hit = hits[hits.length - 1] ?? null;
          cache.set(s, { hit, at: Date.now() });
          if (!cancelled) setResult((r) => ({ ...r, [s]: hit }));
        } catch {
          /* badges are optional */
        }
      }
    };
    if (document.visibilityState === 'visible') void Promise.all([worker(), worker(), worker(), worker()]);
    return () => {
      cancelled = true;
      c.abort();
    };
  }, [key, tick]);

  return result;
}
