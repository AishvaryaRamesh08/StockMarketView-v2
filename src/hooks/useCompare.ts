import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCloses } from '../lib/api.ts';
import { mergeCandles } from '../lib/candles.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import { pollRange, type IntervalId, type PeriodId } from '../lib/ranges.ts';
import type { Candle, ClosesResponse } from '../lib/types.ts';
import type { CompareLine } from '../components/PriceChart.tsx';
import { CLOSED_MS, usePolling } from './usePolling.ts';
import { useNow } from './useNow.ts';

export const COMPARE_COLORS = ['#f5c542', '#2dd4bf', '#f472b6', '#b37feb'];
export const MAX_COMPARE = 4;
/**
 * One batched request a minute for all compared symbols. With the chart (2 a minute) and the
 * batched quotes (2 a minute), a chart with comparisons stays at about 5 requests a minute.
 */
export const COMPARE_POLL_MS = 60_000;

/** The compare overlay only draws closes, so each close becomes a flat candle. */
export function closesToCandles(closes: Array<[number, number]>): Candle[] {
  return closes.map(([t, c]) => ({ t, o: c, h: c, l: c, c, v: 0 }));
}

function toLines(symbols: string[], res: ClosesResponse): { ok: CompareLine[]; bad: string[] } {
  const by = new Map(res.series.map((s) => [s.symbol, s]));
  const ok: CompareLine[] = [];
  const bad: string[] = [];
  symbols.forEach((sym, i) => {
    const s = by.get(sym);
    if (!s || s.closes.length === 0) return bad.push(sym);
    ok.push({
      symbol: sym,
      // Indices read better by name ("S&P 500"); stocks by ticker ("MSFT").
      label: sym.startsWith('^') ? s.name : sym.replace(/\.(NS|BO)$/, ''),
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      timezone: s.timezone,
      candles: closesToCandles(s.closes),
    });
  });
  return { ok, bad };
}

/**
 * Price history for every compared symbol, from one batched request, then refreshed with one
 * batched request a minute while any of their markets is open (never one request per symbol).
 */
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
    fetchCloses(symbols, period, interval, c.signal)
      .then((res) => {
        const { ok, bad } = toLines(symbols, res);
        setLines(ok);
        setFailed(bad);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setLines([]);
        setFailed(symbols);
      });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const now = useNow(60_000);
  const anyOpen = useMemo(() => symbols.some((s) => marketStatus(marketOf(s), new Date(now)).state === 'open'), [key, now]);

  usePolling(
    useCallback(
      async (signal: AbortSignal) => {
        if (!lines.length) return;
        const res = await fetchCloses(
          lines.map((l) => l.symbol),
          pollRange(interval),
          interval,
          signal,
        );
        const fresh = new Map(res.series.map((s) => [s.symbol, closesToCandles(s.closes)]));
        setLines((prev) => prev.map((l) => (fresh.has(l.symbol) ? { ...l, candles: mergeCandles(l.candles, fresh.get(l.symbol)!) } : l)));
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [lines.length, interval, key],
    ),
    anyOpen ? COMPARE_POLL_MS : CLOSED_MS,
    lines.length > 0,
  );

  return { lines, failed };
}
