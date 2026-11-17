/**
 * Shareable links. The address bar always describes what is on screen, so copying it (or
 * pressing Share) gives a link that restores the same chart:
 *
 *   /?s=RELIANCE.NS&p=6mo&i=1d&o=sma50,rsi&c=TCS.NS,^NSEI&l=multi
 *   /?v=markets&m=IN
 *
 * Drawings are deliberately not included: they stay in the sharer's browser, and the way to
 * share a drawing is the image export.
 */
import { isOverlayId, type OverlayId } from './overlays.ts';
import { isIntervalId, isPeriodId, type IntervalId, type PeriodId } from './ranges.ts';
import type { MarketId } from './types.ts';

export interface LinkState {
  view: 'markets' | 'chart';
  market?: MarketId;
  symbol?: string;
  period?: PeriodId;
  interval?: IntervalId;
  overlays?: OverlayId[];
  compare?: string[];
  layout?: 'single' | 'multi';
}

const SYMBOL_RE = /^[A-Za-z0-9.^=&-]{1,24}$/;
const MAX_COMPARE = 4;

/** Builds the query string (without "?"). Commas and carets stay readable. */
export function encodeLink(s: LinkState): string {
  const parts: string[] = [];
  const add = (k: string, v: string) => parts.push(`${k}=${encodeURIComponent(v).replace(/%2C/g, ',').replace(/%5E/g, '^')}`);
  if (s.view === 'markets') {
    add('v', 'markets');
    if (s.market) add('m', s.market);
    return parts.join('&');
  }
  if (s.symbol) add('s', s.symbol);
  if (s.period) add('p', s.period);
  if (s.interval) add('i', s.interval);
  if (s.overlays) add('o', s.overlays.join(','));
  if (s.compare?.length) add('c', s.compare.join(','));
  if (s.layout === 'multi') add('l', 'multi');
  return parts.join('&');
}

/**
 * Reads a link. Returns null when the URL carries no chart or markets state, so a plain visit
 * keeps the visitor's own last session. Anything invalid is dropped rather than trusted.
 */
export function decodeLink(search: string): LinkState | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (q.get('v') === 'markets') {
    const m = q.get('m');
    return { view: 'markets', market: m === 'IN' || m === 'US' ? m : undefined };
  }
  const symbol = q.get('s') ?? '';
  if (!SYMBOL_RE.test(symbol)) return null;
  const out: LinkState = { view: 'chart', symbol };
  const p = q.get('p');
  const i = q.get('i');
  if (isPeriodId(p)) out.period = p;
  if (isIntervalId(i)) out.interval = i;
  if (q.has('o')) out.overlays = Array.from(new Set((q.get('o') ?? '').split(',').filter(isOverlayId)));
  if (q.has('c')) {
    out.compare = Array.from(new Set((q.get('c') ?? '').split(',').filter((c) => SYMBOL_RE.test(c) && c !== symbol))).slice(0, MAX_COMPARE);
  }
  if (q.get('l') === 'multi') out.layout = 'multi';
  else out.layout = 'single';
  return out;
}
