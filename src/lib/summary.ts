/**
 * The one-line plain-English chart summary, e.g.
 *   "Above 50-day average · RSI 68 · Bearish engulfing 2 days ago"
 * Rule-based (no AI, no API key), computed from the candles on screen.
 */
import { lastValue, macd, rsi, sma } from './indicators.ts';
import { detectPatterns, type PatternId } from './patterns.ts';
import { OVERLAY_BY_ID } from './overlays.ts';
import type { IntervalId } from './ranges.ts';
import type { Candle } from './types.ts';

export type Tone = 'bullish' | 'bearish' | 'neutral';

export interface SummaryPart {
  text: string;
  tone: Tone;
  /** Short explanation shown on hover. */
  hint: string;
}

const UNIT: Partial<Record<IntervalId, [string, string]>> = {
  '1d': ['day', 'days'],
  '1wk': ['week', 'weeks'],
  '1mo': ['month', 'months'],
};

function barsAgo(n: number, interval: IntervalId): string {
  const unit = UNIT[interval];
  if (n === 0) return unit ? `this ${unit[0]}` : 'on the latest candle';
  if (!unit) return `${n} candle${n === 1 ? '' : 's'} ago`;
  return `${n} ${n === 1 ? unit[0] : unit[1]} ago`;
}

function averageName(n: number, interval: IntervalId): string {
  const unit = UNIT[interval];
  return unit ? `${n}-${unit[0]} average` : `${n}-candle average`;
}

/** Index of the most recent bar (within `lookback`) where `a` crossed `b`; sign = direction. */
function lastCross(a: (number | null)[], b: (number | null)[], lookback: number): { ago: number; up: boolean } | null {
  const n = a.length;
  for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
    const a0 = a[i - 1], b0 = b[i - 1], a1 = a[i], b1 = b[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (a0 <= b0 && a1 > b1) return { ago: n - 1 - i, up: true };
    if (a0 >= b0 && a1 < b1) return { ago: n - 1 - i, up: false };
  }
  return null;
}

export function summarize(candles: Candle[], interval: IntervalId, high52?: number | null): SummaryPart[] {
  const parts: SummaryPart[] = [];
  if (candles.length < 15) return parts;
  const closes = candles.map((c) => c.c);
  const price = closes[closes.length - 1];

  // 1. Trend versus the 50 (or 20) average, plus a recent golden/death cross.
  const longN = closes.length >= 50 ? 50 : closes.length >= 20 ? 20 : 0;
  if (longN) {
    const avg = lastValue(sma(closes, longN))!;
    const above = price >= avg;
    const pct = ((price - avg) / avg) * 100;
    parts.push({
      text: `${above ? 'Above' : 'Below'} ${averageName(longN, interval)}`,
      tone: above ? 'bullish' : 'bearish',
      hint: `Price is ${Math.abs(pct).toFixed(1)}% ${above ? 'above' : 'below'} the average close of the last ${longN} candles, so the ${longN === 50 ? 'medium' : 'short'}-term trend is ${above ? 'up' : 'down'}.`,
    });
  }
  if (closes.length >= 210) {
    const cross = lastCross(sma(closes, 50), sma(closes, 200), 15);
    if (cross) {
      parts.push({
        text: `${cross.up ? 'Golden' : 'Death'} cross ${barsAgo(cross.ago, interval)}`,
        tone: cross.up ? 'bullish' : 'bearish',
        hint: `The 50 average crossed ${cross.up ? 'above' : 'below'} the 200 average, a widely watched long-term ${cross.up ? 'bullish' : 'bearish'} signal.`,
      });
    }
  }

  // 2. RSI with its zone.
  const r = lastValue(rsi(closes, 14));
  if (r != null) {
    const zone = r >= 70 ? 'overbought' : r <= 30 ? 'oversold' : null;
    parts.push({
      text: `RSI ${Math.round(r)}${zone ? ` (${zone})` : ''}`,
      tone: zone === 'oversold' ? 'bullish' : zone === 'overbought' ? 'bearish' : 'neutral',
      hint: zone
        ? `RSI above 70 or below 30 means the recent move has been unusually one-sided and may be stretched.`
        : 'RSI between 30 and 70: momentum is neither stretched up nor down.',
    });
  }

  // 3. A fresh MACD crossover.
  if (closes.length >= 40) {
    const m = macd(closes);
    const cross = lastCross(m.macd, m.signal, 5);
    if (cross) {
      parts.push({
        text: `MACD crossed ${cross.up ? 'above' : 'below'} signal ${barsAgo(cross.ago, interval)}`,
        tone: cross.up ? 'bullish' : 'bearish',
        hint: `Momentum turned ${cross.up ? 'up' : 'down'}: the fast/slow average gap moved ${cross.up ? 'above' : 'below'} its own average.`,
      });
    }
  }

  // 4. The most recent meaningful candlestick pattern in the last 5 candles.
  // Detect on the last 30 bars (patterns need some history for trend context), report the last 5.
  const tail = candles.slice(-30);
  const lastIdx = tail.length - 1;
  const recent = detectPatterns(tail).filter((h) => h.index >= lastIdx - 4 && h.pattern !== 'doji');
  const latest = recent[recent.length - 1];
  if (latest) {
    const def = OVERLAY_BY_ID.get(latest.pattern as PatternId)!;
    parts.push({
      text: `${def.label} ${barsAgo(lastIdx - latest.index, interval)}`,
      tone: latest.bias,
      hint: def.info,
    });
  }

  // 5. Near the 52-week high.
  if (high52 && price >= high52 * 0.97) {
    parts.push({ text: 'Near 52-week high', tone: 'bullish', hint: 'Within 3% of the highest price of the past year.' });
  }

  return parts.slice(0, 5);
}
