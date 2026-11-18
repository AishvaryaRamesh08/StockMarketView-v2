/**
 * "What if I had invested…" on a stock's real daily closes: a lump sum on one day, or a monthly
 * SIP from that day, compared with the index and a fixed deposit. Prices are split-adjusted
 * closes; dividends, taxes and fees are not included.
 */
import type { Candle } from './types.ts';

export interface ValuePoint {
  /** Unix seconds. */
  t: number;
  value: number;
  invested: number;
}

export interface Outcome {
  /** First candle on or after the chosen start. */
  startT: number;
  endT: number;
  invested: number;
  value: number;
  gain: number;
  gainPct: number;
  /** Lump sum: CAGR. SIP: XIRR (the annual return that explains every installment). Null under ~3 months. */
  annualPct: number | null;
  installments: number;
  series: ValuePoint[];
}

const YEAR = 365.25 * 86400;

/**
 * Whole years of history available, for the "N years ago" buttons. A "10 years" download ends
 * a day or two short of exactly ten years (its first candle is the first trading day in range),
 * so up to about two weeks' shortfall still counts; the plan then starts on the first candle.
 */
export function availableYears(firstT: number, lastT: number): number {
  return Math.floor((lastT - firstT) / YEAR + 0.04);
}

/** Index of the first candle at or after `t`, or -1. */
export function startIndex(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (candles[m].t < t) lo = m + 1;
    else hi = m;
  }
  return lo < candles.length ? lo : -1;
}

/** Thins a long daily series to about `max` points for a small chart, always keeping the last. */
function thin<T>(xs: T[], max = 260): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  out.push(xs[xs.length - 1]);
  return out;
}

export function lumpSum(candles: Candle[], start: number, amount: number): Outcome | null {
  const i = startIndex(candles, start);
  if (i < 0 || amount <= 0) return null;
  const units = amount / candles[i].c;
  const last = candles[candles.length - 1];
  const value = units * last.c;
  const years = (last.t - candles[i].t) / YEAR;
  return {
    startT: candles[i].t,
    endT: last.t,
    invested: amount,
    value,
    gain: value - amount,
    gainPct: (value / amount - 1) * 100,
    annualPct: years >= 0.25 ? (Math.pow(value / amount, 1 / years) - 1) * 100 : null,
    installments: 1,
    series: thin(candles.slice(i).map((c) => ({ t: c.t, value: units * c.c, invested: amount }))),
  };
}

/** The first candle of each calendar month (UTC) from `start`. */
export function monthlyDates(candles: Candle[], start: number): number[] {
  const out: number[] = [];
  let lastKey = '';
  for (let i = Math.max(0, startIndex(candles, start)); i < candles.length && i >= 0; i++) {
    const d = new Date(candles[i].t * 1000);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (key !== lastKey) {
      out.push(i);
      lastKey = key;
    }
  }
  return out;
}

export function sip(candles: Candle[], start: number, monthly: number): Outcome | null {
  const idx = monthlyDates(candles, start);
  if (!idx.length || monthly <= 0 || startIndex(candles, start) < 0) return null;
  const buyAt = new Set(idx);
  let units = 0;
  let invested = 0;
  const first = idx[0];
  const series: ValuePoint[] = [];
  for (let i = first; i < candles.length; i++) {
    if (buyAt.has(i)) {
      units += monthly / candles[i].c;
      invested += monthly;
    }
    series.push({ t: candles[i].t, value: units * candles[i].c, invested });
  }
  const last = candles[candles.length - 1];
  const value = units * last.c;
  const flows = [...idx.map((i) => ({ t: candles[i].t, amount: -monthly })), { t: last.t, amount: value }];
  const years = (last.t - candles[first].t) / YEAR;
  return {
    startT: candles[first].t,
    endT: last.t,
    invested,
    value,
    gain: value - invested,
    gainPct: invested ? (value / invested - 1) * 100 : 0,
    annualPct: years >= 0.25 ? xirr(flows) : null,
    installments: idx.length,
    series: thin(series),
  };
}

/** Annual rate r with Σ amount·(1+r)^(−years since first flow) = 0, in %. Bisection: robust for any sign pattern here. */
export function xirr(flows: Array<{ t: number; amount: number }>): number | null {
  if (flows.length < 2) return null;
  const t0 = flows[0].t;
  const npv = (r: number) => flows.reduce((a, f) => a + f.amount / Math.pow(1 + r, (f.t - t0) / YEAR), 0);
  let lo = -0.99;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid * 100;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return ((lo + hi) / 2) * 100;
}

/** A fixed deposit at `ratePct` a year, compounded quarterly, for the same flows (one deposit or one a month). */
export function fixedDeposit(startTimes: number[], each: number, endT: number, ratePct: number): { invested: number; value: number } {
  const q = ratePct / 100 / 4;
  let value = 0;
  for (const t of startTimes) value += each * Math.pow(1 + q, (4 * Math.max(0, endT - t)) / YEAR);
  return { invested: each * startTimes.length, value };
}

/** Same plan on another series (the index), using that series' own trading days. */
export function samePlan(kind: 'lump' | 'sip', candles: Candle[], start: number, amount: number): Outcome | null {
  return kind === 'lump' ? lumpSum(candles, start, amount) : sip(candles, start, amount);
}

/** Times of the installments a plan made, for the matching fixed-deposit comparison. */
export function planDates(kind: 'lump' | 'sip', candles: Candle[], start: number): number[] {
  if (kind === 'lump') {
    const i = startIndex(candles, start);
    return i < 0 ? [] : [candles[i].t];
  }
  return monthlyDates(candles, start).map((i) => candles[i].t);
}
