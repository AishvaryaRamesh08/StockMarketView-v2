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
  let cut = history.length;
  while (cut > 0 && history[cut - 1].t >= from) cut--;
  return history.slice(0, cut).concat(fresh);
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
