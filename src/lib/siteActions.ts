/**
 * Changes to what's on screen that both the command palette and Ask AI can make. Each action
 * works out a patch from the current settings, applies it, and returns it, so Ask AI can carry
 * on from the result within the same reply (before React has re-rendered).
 */
import type { Frame } from './frames.ts';
import type { OverlayId } from './overlays.ts';
import type { IntervalId, PeriodId } from './ranges.ts';
import type { MarketId } from './types.ts';
import { marketOf } from './markets.ts';

/** The part of the page settings these actions read and change. */
export interface ScreenState {
  symbol: string;
  period: PeriodId;
  interval: IntervalId;
  overlays: OverlayId[];
  compare: string[];
  layout: 'single' | 'multi';
  view: 'markets' | 'chart' | 'portfolio';
}

export type ScreenPatch = Partial<ScreenState> & { frames?: Frame[]; market?: MarketId };

export interface SiteActions {
  openChart: (cur: ScreenState, symbol: string, opts?: { period?: PeriodId; interval?: IntervalId; layout?: 'single' | 'multi' }) => ScreenPatch;
  setOverlay: (cur: ScreenState, id: OverlayId, on: boolean) => ScreenPatch;
  setCompare: (cur: ScreenState, symbols: string[]) => ScreenPatch;
  openMarkets: (market?: MarketId) => ScreenPatch;
  showMultiTimeframe: (symbol: string, frames: Frame[]) => ScreenPatch;
}

export function createSiteActions(apply: (patch: ScreenPatch) => void, remember: (symbol: string) => void, maxCompare: number): SiteActions {
  const run = (patch: ScreenPatch) => {
    apply(patch);
    return patch;
  };
  return {
    openChart: (cur, symbol, opts = {}) => {
      remember(symbol);
      return run({
        symbol,
        // The IN / US choice follows the stock on screen.
        market: marketOf(symbol),
        view: 'chart',
        // A stock can't be compared with itself.
        compare: cur.compare.filter((c) => c !== symbol),
        ...(opts.period ? { period: opts.period } : {}),
        ...(opts.interval ? { interval: opts.interval } : {}),
        ...(opts.layout ? { layout: opts.layout } : {}),
      });
    },
    setOverlay: (cur, id, on) => {
      if (cur.overlays.includes(id) === on) return run({ view: 'chart' });
      return run({ view: 'chart', overlays: on ? [...cur.overlays, id] : cur.overlays.filter((o) => o !== id) });
    },
    setCompare: (cur, symbols) =>
      run({
        view: 'chart',
        layout: 'single',
        compare: [...new Set(symbols)].filter((s) => s !== cur.symbol).slice(0, maxCompare),
      }),
    openMarkets: (market) => run({ view: 'markets', ...(market ? { market } : {}) }),
    showMultiTimeframe: (symbol, frames) => {
      remember(symbol);
      return run({ symbol, market: marketOf(symbol), view: 'chart', layout: 'multi', frames });
    },
  };
}
