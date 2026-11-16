/**
 * Automatic key levels: 52-week high/low, the previous session's high/low, and support and
 * resistance found from repeated swing highs and lows.
 */
import { atr, lastValue } from './indicators.ts';
import type { Candle } from './types.ts';

export type LevelKind = 'high52' | 'low52' | 'prevHigh' | 'prevLow' | 'resistance' | 'support';

export interface Level {
  kind: LevelKind;
  price: number;
  label: string;
  /** For support/resistance: how many swing points formed this level. */
  touches?: number;
}

/** Previous completed session's high and low. Intraday bars are grouped by exchange date. */
export function previousSession(candles: Candle[], intraday: boolean, sessionOf: (t: number) => string): { high: number; low: number } | null {
  if (candles.length < 2) return null;
  if (!intraday) {
    const p = candles[candles.length - 2];
    return { high: p.h, low: p.l };
  }
  const lastSession = sessionOf(candles[candles.length - 1].t);
  let i = candles.length - 1;
  while (i >= 0 && sessionOf(candles[i].t) === lastSession) i--;
  if (i < 0) return null;
  const prev = sessionOf(candles[i].t);
  let high = -Infinity;
  let low = Infinity;
  for (; i >= 0 && sessionOf(candles[i].t) === prev; i--) {
    high = Math.max(high, candles[i].h);
    low = Math.min(low, candles[i].l);
  }
  return { high, low };
}

/** Indices of swing highs/lows: a bar higher (lower) than the `k` bars on each side. */
export function swingPoints(candles: Candle[], k = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k && (isHigh || isLow); j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

/**
 * Support and resistance: cluster swing prices that sit within a tolerance (half an ATR, at
 * least 0.4% of price) of each other; a cluster with 2+ touches is a level. Returns up to
 * `perSide` nearest levels above (resistance) and below (support) the current price.
 */
export function supportResistance(candles: Candle[], perSide = 2): Level[] {
  if (candles.length < 30) return [];
  const price = candles[candles.length - 1].c;
  const tol = Math.max((lastValue(atr(candles, 14)) ?? 0) * 0.5, price * 0.004);
  const { highs, lows } = swingPoints(candles);
  const points = [...highs.map((i) => candles[i].h), ...lows.map((i) => candles[i].l)].sort((a, b) => a - b);

  const clusters: { sum: number; n: number }[] = [];
  for (const p of points) {
    const c = clusters[clusters.length - 1];
    if (c && p - c.sum / c.n <= tol) {
      c.sum += p;
      c.n++;
    } else clusters.push({ sum: p, n: 1 });
  }
  const levels = clusters.filter((c) => c.n >= 2).map((c) => ({ price: c.sum / c.n, touches: c.n }));

  const above = levels.filter((l) => l.price > price + tol * 0.25).sort((a, b) => a.price - b.price).slice(0, perSide);
  const below = levels.filter((l) => l.price < price - tol * 0.25).sort((a, b) => b.price - a.price).slice(0, perSide);
  return [
    ...above.map((l) => ({ kind: 'resistance' as const, price: l.price, touches: l.touches, label: `Resistance (${l.touches} touches)` })),
    ...below.map((l) => ({ kind: 'support' as const, price: l.price, touches: l.touches, label: `Support (${l.touches} touches)` })),
  ];
}
