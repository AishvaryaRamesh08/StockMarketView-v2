import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchQuotes } from '../lib/api.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import type { Quote } from '../lib/types.ts';
import { CLOSED_MS, LIVE_MS, usePolling } from './usePolling.ts';
import { useNow } from './useNow.ts';

const BATCH = 20;

/**
 * Live quotes for a set of symbols, fetched 20 per request (the API's batch size) so the index
 * strip, the open chart and a whole watchlist cost one to three requests per refresh.
 * Refreshes every 30s while any of their markets is open, every 5 minutes otherwise.
 */
export function useQuotes(symbols: string[]): { quotes: Record<string, Quote>; lastUpdated: number | null } {
  const key = Array.from(new Set(symbols)).join(',');
  const list = useMemo(() => (key ? key.split(',') : []), [key]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (list.length === 0) return;
      const batches: string[][] = [];
      for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
      const results = await Promise.allSettled(batches.map((b) => fetchQuotes(b, signal)));
      setQuotes((prev) => {
        const next = { ...prev };
        for (const r of results) if (r.status === 'fulfilled') for (const q of r.value.quotes) next[q.symbol] = q;
        return next;
      });
      if (results.some((r) => r.status === 'fulfilled')) setLastUpdated(Date.now());
    },
    [list],
  );

  useEffect(() => {
    const c = new AbortController();
    refresh(c.signal).catch(() => {});
    return () => c.abort();
  }, [refresh]);

  const now = useNow(60_000);
  const anyOpen = list.some((s) => marketStatus(marketOf(s), new Date(now)).state === 'open');
  usePolling(refresh, anyOpen ? LIVE_MS : CLOSED_MS);

  return { quotes, lastUpdated };
}
