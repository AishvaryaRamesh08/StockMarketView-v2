import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchQuotes } from '../lib/api.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import type { Quote } from '../lib/types.ts';
import { CLOSED_MS, LIVE_MS, usePolling } from './usePolling.ts';
import { useNow } from './useNow.ts';

/**
 * Live quotes for a set of symbols in ONE request per refresh (up to 20 symbols).
 * Refreshes every 30s while any of their markets is open, every 5 minutes otherwise.
 */
export function useQuotes(symbols: string[]): { quotes: Record<string, Quote>; lastUpdated: number | null } {
  const list = useMemo(() => Array.from(new Set(symbols)).slice(0, 20), [symbols.join(',')]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (list.length === 0) return;
      const res = await fetchQuotes(list, signal);
      setQuotes((prev) => {
        const next = { ...prev };
        for (const q of res.quotes) next[q.symbol] = q;
        return next;
      });
      setLastUpdated(Date.now());
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
