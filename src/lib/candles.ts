import type { Candle } from './types.ts';

/**
 * Merge a fresh poll (a short recent range) into the full history.
 * Every existing bar at or after the first fresh bar is replaced, so a still-forming candle
 * is updated in place and new candles are appended.
 */
export function mergeCandles(history: Candle[], fresh: Candle[]): Candle[] {
  if (fresh.length === 0) return history;
  if (history.length === 0) return fresh.slice();
  const from = fresh[0].t;
  // Fresh data older than our history means the poll returned something unexpected; keep what we have.
  if (from < history[0].t) return history;
  const to = fresh[fresh.length - 1].t;
  let cut = history.length;
  while (cut > 0 && history[cut - 1].t >= from) cut--;
  // Keep any bars newer than the poll returned: providers occasionally omit the latest
  // candle from a short range, and a refresh must never delete data we already have.
  const newer = history.filter((c) => c.t > to);
  return history.slice(0, cut).concat(fresh, newer);
}

/**
 * Applies a refresh. When the poll covers the whole period on screen (the 1D view), the fresh
 * data replaces the history, so a new trading day pushes yesterday's session off the chart.
 * Otherwise the fresh tail is merged into the longer history.
 */
export function applyRefresh(history: Candle[], fresh: Candle[], pollCoversPeriod: boolean): Candle[] {
  if (pollCoversPeriod && fresh.length > 0) return fresh;
  return mergeCandles(history, fresh);
}

/**
 * How the chart should apply a merge: `update` the trailing bars in place (cheap, no redraw
 * of history) when only the tail changed, otherwise `reset` with the whole series.
 */
export function diffTail(prev: Candle[], next: Candle[]): { kind: 'reset' } | { kind: 'update'; bars: Candle[] } {
  if (prev.length === 0 || next.length < prev.length) return { kind: 'reset' };
  const lastPrevT = prev[prev.length - 1].t;
  // Find where `next` reaches the last bar we already drew.
  let i = next.length - 1;
  while (i >= 0 && next[i].t > lastPrevT) i--;
  if (i < 0 || next[i].t !== lastPrevT || i !== prev.length - 1) return { kind: 'reset' };
  return { kind: 'update', bars: next.slice(i) };
}

/**
 * One daily candle built from a session's intraday bars: first open, highest high, lowest low,
 * last price, total volume. Used when the provider sends today's daily candle empty (Yahoo does
 * this for NSE/BSE stocks) but has the intraday bars.
 */
export function sessionFromIntraday(t: number, intraday: Candle[], lastPrice?: number | null, dayVolume?: number | null): Candle | null {
  if (intraday.length === 0) return null;
  const c = lastPrice ?? intraday[intraday.length - 1].c;
  let h = c;
  let l = c;
  let v = 0;
  for (const b of intraday) {
    if (b.h > h) h = b.h;
    if (b.l < l) l = b.l;
    v += b.v;
  }
  // Intraday bars miss the opening and closing auctions, so prefer the day's reported total.
  return { t, o: intraday[0].o, h, l, c, v: dayVolume != null && dayVolume > 0 ? dayVolume : v };
}
