import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, fetchChart } from '../lib/api.ts';
import { mergeCandles } from '../lib/candles.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import { pollRange, type IntervalId, type PeriodId } from '../lib/ranges.ts';
import type { Candle, Quote } from '../lib/types.ts';
import { CLOSED_MS, LIVE_MS, usePolling } from './usePolling.ts';
import { useNow } from './useNow.ts';

export interface LiveChart {
  status: 'loading' | 'ready' | 'error';
  candles: Candle[];
  quote: Quote | null;
  /** Set when the first load failed (status 'error') or the latest refresh failed (status 'ready'). */
  error: string | null;
  notFound: boolean;
  lastUpdated: number | null;
  /** Bumped whenever the whole series was replaced, so the chart knows to refit. */
  version: string;
  retry: () => void;
}

/**
 * Loads full history once, then refreshes only the most recent candles every 30 seconds
 * while the symbol's market is open (every 5 minutes when it is closed).
 */
export function useLiveChart(symbol: string, period: PeriodId, interval: IntervalId): LiveChart {
  const key = `${symbol}|${period}|${interval}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<LiveChart, 'retry' | 'version'> & { key: string }>({
    key,
    status: 'loading',
    candles: [],
    quote: null,
    error: null,
    notFound: false,
    lastUpdated: null,
  });

  // Initial (full-history) load whenever the symbol, period or interval changes.
  useEffect(() => {
    const controller = new AbortController();
    // Keep the quote (same symbol on a period change, so the header doesn't flicker) but drop
    // the old candles: they belong to a different series and must not be drawn under the new key.
    setState((s) => ({ ...s, key, status: 'loading', candles: [], error: null, notFound: false, quote: s.quote?.symbol === symbol ? s.quote : null }));
    fetchChart(symbol, period, interval, controller.signal)
      .then((res) => {
        setState({ key, status: 'ready', candles: res.candles, quote: res.quote, error: null, notFound: false, lastUpdated: Date.now() });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        const notFound = err instanceof ApiFailure && err.status === 404;
        setState({ key, status: 'error', candles: [], quote: null, error: (err as Error).message, notFound, lastUpdated: null });
      });
    return () => controller.abort();
  }, [key, symbol, period, interval, attempt]);

  const ready = state.status === 'ready' && state.key === key;
  // Re-check once a minute so polling speeds up by itself when the market opens.
  const now = useNow(60_000);
  const open = marketStatus(marketOf(symbol), new Date(now)).state === 'open';

  usePolling(
    useCallback(
      async (signal: AbortSignal) => {
        try {
          const res = await fetchChart(symbol, pollRange(interval), interval, signal);
          setState((s) => {
            if (s.key !== key) return s;
            const prev = s.quote;
            return {
              ...s,
              candles: mergeCandles(s.candles, res.candles),
              // The short poll range can't always tell yesterday's close; keep the one we had.
              quote: res.quote.prevClose == null && prev ? { ...res.quote, prevClose: prev.prevClose, change: prev.change, changePct: prev.changePct } : res.quote,
              error: null,
              lastUpdated: Date.now(),
            };
          });
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          setState((s) => (s.key === key ? { ...s, error: (err as Error).message } : s));
        }
      },
      [key, symbol, interval],
    ),
    open ? LIVE_MS : CLOSED_MS,
    ready,
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = state.key === key ? state : { ...state, status: 'loading' as const, candles: [], quote: null };
  return { ...current, version: `${key}|${attempt}`, retry };
}
