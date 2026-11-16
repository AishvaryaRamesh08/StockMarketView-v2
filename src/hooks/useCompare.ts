import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchChart } from '../lib/api.ts';
import { mergeCandles } from '../lib/candles.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import { pollRange, type IntervalId, type PeriodId } from '../lib/ranges.ts';
import type { CompareLine } from '../components/PriceChart.tsx';
import { CLOSED_MS, LIVE_MS, usePolling } from './usePolling.ts';
import { useNow } from './useNow.ts';

export const COMPARE_COLORS = ['#f5c542', '#2dd4bf', '#f472b6', '#b37feb'];
export const MAX_COMPARE = 4;

/** Price history for each compared symbol, refreshed like the main chart. */
export function useCompare(symbols: string[], period: PeriodId, interval: IntervalId): { lines: CompareLine[]; failed: string[] } {
  const key = `${symbols.join(',')}|${period}|${interval}`;
  const [lines, setLines] = useState<CompareLine[]>([]);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    if (symbols.length === 0) {
      setLines([]);
      setFailed([]);
      return;
    }
    const c = new AbortController();
    Promise.allSettled(symbols.map((s) => fetchChart(s, period, interval, c.signal))).then((results) => {
      if (c.signal.aborted) return;
      const ok: CompareLine[] = [];
      const bad: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          ok.push({
            symbol: symbols[i],
            // Indices read better by name ("S&P 500"); stocks by ticker ("MSFT").
            label: symbols[i].startsWith('^') ? r.value.quote.name : symbols[i].replace(/\.(NS|BO)$/, ''),
            color: COMPARE_COLORS[i % COMPARE_COLORS.length],
            timezone: r.value.quote.timezone,
            candles: r.value.candles,
          });
        } else bad.push(symbols[i]);
      });
      setLines(ok);
      setFailed(bad);
    });
    return () => c.abort();
  }, [key]);

  const now = useNow(60_000);
  const anyOpen = useMemo(() => symbols.some((s) => marketStatus(marketOf(s), new Date(now)).state === 'open'), [key, now]);

  usePolling(
    useCallback(
      async (signal: AbortSignal) => {
        const fresh = await Promise.allSettled(lines.map((l) => fetchChart(l.symbol, pollRange(interval), interval, signal)));
        setLines((prev) =>
          prev.map((l, i) => {
            const r = fresh[i];
            return r?.status === 'fulfilled' ? { ...l, candles: mergeCandles(l.candles, r.value.candles) } : l;
          }),
        );
      },
      [lines.length, interval, key],
    ),
    anyOpen ? LIVE_MS : CLOSED_MS,
    lines.length > 0,
  );

  return { lines, failed };
}
