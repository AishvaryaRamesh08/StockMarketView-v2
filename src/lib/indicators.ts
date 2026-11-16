/**
 * Technical indicators. Every function returns arrays aligned 1:1 with its input, using `null`
 * for the warm-up bars where the indicator isn't defined yet. Definitions follow the standard
 * (TA-Lib) conventions so values match other charting tools.
 */
import type { Candle } from './types.ts';

export type Series = (number | null)[];

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  let seen = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed += v;
      seen++;
      if (seen === period) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Bollinger Bands: SMA ± `mult` population standard deviations. */
export function bollinger(values: number[], period = 20, mult = 2): { upper: Series; middle: Series; lower: Series } {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = middle[i]!;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, middle, lower };
}

/** Relative Strength Index with Wilder's smoothing. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** MACD line (fast EMA − slow EMA), its signal EMA, and the histogram. */
export function macd(values: number[], fast = 12, slow = 26, signal = 9): { macd: Series; signal: Series; histogram: Series } {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Series = values.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const sig = ema(line, signal);
  const histogram: Series = line.map((m, i) => (m != null && sig[i] != null ? m - sig[i]! : null));
  return { macd: line, signal: sig, histogram };
}

/**
 * Volume-weighted average price, reset at the start of each trading session.
 * `sessionOf` maps a bar to its session (exchange-local date) so the reset happens at the open.
 */
export function vwap(candles: Candle[], sessionOf: (t: number) => string): Series {
  const out: Series = new Array(candles.length).fill(null);
  let session = '';
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const s = sessionOf(c.t);
    if (s !== session) {
      session = s;
      pv = 0;
      vol = 0;
    }
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * c.v;
    vol += c.v;
    out[i] = vol > 0 ? pv / vol : typical;
  }
  return out;
}

/** Parabolic SAR (Wilder), acceleration step 0.02 up to 0.2. */
export function parabolicSar(candles: Candle[], step = 0.02, max = 0.2): Series {
  const n = candles.length;
  const out: Series = new Array(n).fill(null);
  if (n < 2) return out;
  let long = candles[1].c >= candles[0].c;
  let af = step;
  let ep = long ? Math.max(candles[0].h, candles[1].h) : Math.min(candles[0].l, candles[1].l);
  let sar = long ? Math.min(candles[0].l, candles[1].l) : Math.max(candles[0].h, candles[1].h);
  out[1] = sar;
  for (let i = 2; i < n; i++) {
    const c = candles[i];
    sar = sar + af * (ep - sar);
    if (long) {
      // SAR may not move into the prior two bars' range.
      sar = Math.min(sar, candles[i - 1].l, candles[i - 2].l);
      if (c.l < sar) {
        long = false;
        sar = ep;
        ep = c.l;
        af = step;
      } else if (c.h > ep) {
        ep = c.h;
        af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, candles[i - 1].h, candles[i - 2].h);
      if (c.h > sar) {
        long = true;
        sar = ep;
        ep = c.h;
        af = step;
      } else if (c.l < ep) {
        ep = c.l;
        af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
  }
  return out;
}

function midpoint(candles: Candle[], end: number, period: number): number | null {
  if (end < period - 1) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = end - period + 1; j <= end; j++) {
    if (candles[j].h > hi) hi = candles[j].h;
    if (candles[j].l < lo) lo = candles[j].l;
  }
  return (hi + lo) / 2;
}

/**
 * Ichimoku Cloud (9, 26, 52). Senkou spans are plotted `displacement` bars ahead, so they are
 * returned with `displacement` extra slots at the end for bars that don't exist yet.
 */
export function ichimoku(candles: Candle[], conv = 9, base = 26, spanB = 52, displacement = 26) {
  const n = candles.length;
  const tenkan: Series = candles.map((_, i) => midpoint(candles, i, conv));
  const kijun: Series = candles.map((_, i) => midpoint(candles, i, base));
  const senkouA: Series = new Array(n + displacement).fill(null);
  const senkouB: Series = new Array(n + displacement).fill(null);
  for (let i = 0; i < n; i++) {
    if (tenkan[i] != null && kijun[i] != null) senkouA[i + displacement] = (tenkan[i]! + kijun[i]!) / 2;
    senkouB[i + displacement] = midpoint(candles, i, spanB);
  }
  const chikou: Series = new Array(n).fill(null);
  for (let i = displacement; i < n; i++) chikou[i - displacement] = candles[i].c;
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

/** Average True Range (Wilder). Used to size support/resistance zones. */
export function atr(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c))));
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

export function lastValue(s: Series): number | null {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i];
  return null;
}
