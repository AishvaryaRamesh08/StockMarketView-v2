import { useEffect, useRef, useState, type RefObject } from 'react';
import { fetchChart } from '../lib/api.ts';
import type { IntervalId, PeriodId } from '../lib/ranges.ts';
import type { Candle } from '../lib/types.ts';

const cache = new Map<string, Promise<Candle[]>>();

/** Long history for one symbol and interval, fetched once per visit and shared by every card that needs it. */
export function loadHistory(symbol: string, period: PeriodId, interval: IntervalId): Promise<Candle[]> {
  const key = `${symbol}|${period}|${interval}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchChart(symbol, period, interval).then((r) => r.candles);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export interface HistoryState {
  candles: Candle[] | null;
  error: string | null;
}

/** Ten years of daily candles, loaded only once `enabled` turns true (e.g. when a card scrolls into view). */
export function useDailyHistory(symbol: string | null, enabled: boolean): HistoryState {
  const [state, setState] = useState<{ key: string; candles: Candle[] | null; error: string | null }>({ key: '', candles: null, error: null });
  useEffect(() => {
    if (!symbol || !enabled) return;
    let live = true;
    loadHistory(symbol, '10y', '1d')
      .then((candles) => live && setState({ key: symbol, candles, error: null }))
      .catch((err: Error) => live && setState({ key: symbol, candles: null, error: err.message || "History didn't load" }));
    return () => {
      live = false;
    };
  }, [symbol, enabled]);
  return state.key === symbol ? state : { candles: null, error: null };
}

/**
 * True once the element has come near the viewport; stays true. Saves requests for cards nobody
 * scrolls to. IntersectionObserver does the work; a plain position check on scroll and resize
 * backs it up, since some embedded or background views never deliver observer callbacks.
 */
export function useSeen(ref: RefObject<Element | null>, marginPx = 200): boolean {
  const [seen, setSeen] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || done.current) return;
    const mark = () => {
      if (done.current) return;
      done.current = true;
      setSeen(true);
      cleanup();
    };
    const near = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight + marginPx && r.bottom > -marginPx) mark();
    };
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && mark(), { rootMargin: `${marginPx}px` }) : null;
    io?.observe(el);
    window.addEventListener('scroll', near, { passive: true });
    window.addEventListener('resize', near);
    const first = setTimeout(near, 0);
    function cleanup() {
      io?.disconnect();
      clearTimeout(first);
      window.removeEventListener('scroll', near);
      window.removeEventListener('resize', near);
    }
    return cleanup;
  }, [ref, marginPx]);
  return seen;
}
