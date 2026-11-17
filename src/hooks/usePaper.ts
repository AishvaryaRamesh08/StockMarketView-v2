import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marketStatus } from '../lib/markets.ts';
import {
  cancelOrder,
  isPaperState,
  newPaperState,
  openOrders,
  placeOrder,
  processTicks,
  recordEquity,
  summarize,
  type Order,
  type OrderInput,
  type PaperState,
  type PriceTick,
} from '../lib/paper.ts';
import { load, save } from '../lib/storage.ts';
import type { MarketId, Quote } from '../lib/types.ts';

const KEY = 'smv.paper';
const isOpenNow = (m: MarketId) => marketStatus(m).state === 'open';

function ticksFrom(quotes: Record<string, Quote>): Record<string, PriceTick> {
  const out: Record<string, PriceTick> = {};
  for (const [sym, q] of Object.entries(quotes)) if (q.price != null && q.marketTime != null) out[sym] = { price: q.price, time: q.marketTime * 1000 };
  return out;
}

/**
 * Paper-trading state for this browser.
 *
 * The page's batched quotes call includes `watchSymbols` (positions and working orders), and
 * the page hands each fresh batch to `feed`, which checks working orders and adds equity-curve
 * points. So paper trading adds no requests of its own beyond one extra symbol per holding.
 */
export function usePaper(onFills: (orders: Order[]) => void) {
  const [state, setState] = useState<PaperState>(() => load(KEY, newPaperState(), isPaperState));
  const [ticks, setTicks] = useState<Record<string, PriceTick>>({});
  useEffect(() => save(KEY, state), [state]);
  const onFillsRef = useRef(onFills);
  onFillsRef.current = onFills;

  const prices = useMemo(() => Object.fromEntries(Object.entries(ticks).map(([k, v]) => [k, v.price])), [ticks]);

  const feed = useCallback((quotes: Record<string, Quote>) => {
    const t = ticksFrom(quotes);
    const px = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.price]));
    setTicks(t);
    setState((s) => {
      const r = processTicks(s, t, isOpenNow);
      let next = r.state;
      for (const m of ['IN', 'US'] as const) {
        const filledHere = r.changed.some((o) => o.market === m && o.status === 'filled');
        const held = next.positions.filter((p) => p.market === m);
        if (!held.length && !filledHere) continue;
        if (held.some((p) => px[p.symbol] == null)) continue;
        next = recordEquity(next, m, summarize(next, m, px).equity, Date.now(), filledHere);
      }
      // Report fills after this update has been applied.
      if (r.changed.length) setTimeout(() => onFillsRef.current(r.changed), 0);
      return next;
    });
  }, []);

  const watchSymbols = useMemo(
    () => Array.from(new Set([...state.positions.map((p) => p.symbol), ...openOrders(state).map((o) => o.symbol)])).sort(),
    [state.positions, state.orders],
  );

  const place = useCallback(
    (input: OrderInput): { order?: Order; error?: string } => {
      const r = placeOrder(state, input, ticks[input.symbol], isOpenNow(input.market));
      if (r.error) return { error: r.error };
      let next = r.state;
      if (r.order?.status === 'filled') next = recordEquity(next, input.market, summarize(next, input.market, prices).equity, Date.now(), true);
      setState(next);
      return { order: r.order };
    },
    [state, ticks, prices],
  );

  return {
    state,
    prices,
    ticks,
    watchSymbols,
    feed,
    place,
    cancel: useCallback((id: string) => setState((s) => cancelOrder(s, id)), []),
    reset: useCallback((budget: Record<MarketId, number>) => setState(newPaperState(budget)), []),
    importState: useCallback((json: unknown): boolean => {
      if (!isPaperState(json)) return false;
      setState(json);
      return true;
    }, []),
  };
}

export type PaperApi = ReturnType<typeof usePaper>;
