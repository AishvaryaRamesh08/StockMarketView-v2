/**
 * Candlestick pattern detection on completed bars. The rules follow the common textbook
 * definitions (close to TA-Lib's), with trend context for reversal patterns: a hammer only
 * counts after a decline, a shooting star only after a rise.
 */
import type { Candle } from './types.ts';

export type PatternId =
  | 'bullishEngulfing'
  | 'bearishEngulfing'
  | 'hammer'
  | 'shootingStar'
  | 'doji'
  | 'morningStar'
  | 'eveningStar'
  | 'bullishHarami'
  | 'bearishHarami';

export type Bias = 'bullish' | 'bearish' | 'neutral';

export interface PatternHit {
  /** Index of the bar that completes the pattern. */
  index: number;
  t: number;
  pattern: PatternId;
  bias: Bias;
}

export const PATTERN_BIAS: Record<PatternId, Bias> = {
  bullishEngulfing: 'bullish',
  bearishEngulfing: 'bearish',
  hammer: 'bullish',
  shootingStar: 'bearish',
  doji: 'neutral',
  morningStar: 'bullish',
  eveningStar: 'bearish',
  bullishHarami: 'bullish',
  bearishHarami: 'bearish',
};

const body = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => c.h - c.l;
const upperShadow = (c: Candle) => c.h - Math.max(c.o, c.c);
const lowerShadow = (c: Candle) => Math.min(c.o, c.c) - c.l;
const isBull = (c: Candle) => c.c > c.o;
const isBear = (c: Candle) => c.c < c.o;

/** Average body size over the `n` bars before `i`, to judge what "small" and "long" mean here. */
function avgBody(candles: Candle[], i: number, n = 10): number {
  const from = Math.max(0, i - n);
  if (from === i) return body(candles[i]);
  let s = 0;
  for (let j = from; j < i; j++) s += body(candles[j]);
  return s / (i - from);
}

/** Price direction over the `n` bars ending just before `i`: positive = rising. */
function priorTrend(candles: Candle[], i: number, n = 5): number {
  if (i - n < 0) return 0;
  return candles[i - 1].c - candles[i - n].c;
}

export function detectAt(candles: Candle[], i: number): PatternId[] {
  const out: PatternId[] = [];
  const c = candles[i];
  const r = range(c);
  if (r <= 0) return out;
  const avg = avgBody(candles, i);

  // Doji: open and close almost equal relative to the bar's range.
  const isDoji = body(c) <= r * 0.1;
  if (isDoji) out.push('doji');

  // Hammer: small body near the top, lower shadow at least twice the body, after a decline.
  if (!isDoji && lowerShadow(c) >= 2 * body(c) && upperShadow(c) <= body(c) * 0.5 + r * 0.05 && priorTrend(candles, i) < 0) out.push('hammer');

  // Shooting star: small body near the bottom, long upper shadow, after a rise.
  if (!isDoji && upperShadow(c) >= 2 * body(c) && lowerShadow(c) <= body(c) * 0.5 + r * 0.05 && priorTrend(candles, i) > 0) out.push('shootingStar');

  if (i >= 1) {
    const p = candles[i - 1];
    // Engulfing: today's real body covers yesterday's opposite-coloured body.
    if (isBear(p) && isBull(c) && c.o <= p.c && c.c >= p.o && body(c) > body(p)) out.push('bullishEngulfing');
    if (isBull(p) && isBear(c) && c.o >= p.c && c.c <= p.o && body(c) > body(p)) out.push('bearishEngulfing');

    // Harami: a long body followed by a small opposite body inside it.
    const longPrev = body(p) >= avg;
    if (longPrev && isBear(p) && isBull(c) && c.o > p.c && c.c < p.o && body(c) < body(p) * 0.6) out.push('bullishHarami');
    if (longPrev && isBull(p) && isBear(c) && c.o < p.c && c.c > p.o && body(c) < body(p) * 0.6) out.push('bearishHarami');
  }

  if (i >= 2) {
    const a = candles[i - 2];
    const b = candles[i - 1];
    const smallMiddle = body(b) <= avg * 0.5;
    // Morning star: long red, small middle bar gapping lower, long green closing into the first body.
    if (isBear(a) && body(a) >= avg && smallMiddle && Math.max(b.o, b.c) < a.c && isBull(c) && body(c) >= avg * 0.6 && c.c > (a.o + a.c) / 2) out.push('morningStar');
    // Evening star: the mirror image at a top.
    if (isBull(a) && body(a) >= avg && smallMiddle && Math.min(b.o, b.c) > a.c && isBear(c) && body(c) >= avg * 0.6 && c.c < (a.o + a.c) / 2) out.push('eveningStar');
  }
  return out;
}

/** All pattern hits in the series, optionally limited to the given pattern types. */
export function detectPatterns(candles: Candle[], only?: ReadonlySet<PatternId>): PatternHit[] {
  const hits: PatternHit[] = [];
  for (let i = 0; i < candles.length; i++) {
    for (const p of detectAt(candles, i)) {
      if (only && !only.has(p)) continue;
      hits.push({ index: i, t: candles[i].t, pattern: p, bias: PATTERN_BIAS[p] });
    }
  }
  return hits;
}
