/**
 * "How often has this pattern worked on this stock?" Each time a pattern formed in the stock's
 * own daily history, what did the price do over the next N candles? Compared with how often the
 * price simply rose over any N candles (the base rate), so a "58% win rate" can be judged against
 * the stock's normal drift. Educational statistics on past data, not a prediction.
 */
import { detectPatterns, PATTERN_BIAS, type Bias, type PatternId } from './patterns.ts';
import type { Candle } from './types.ts';

export interface PatternRecord {
  pattern: PatternId;
  bias: Bias;
  /** Times it formed with at least `horizon` candles of history after it. */
  count: number;
  /** Bullish: price higher after N candles. Bearish: lower. Neutral (doji): higher. */
  workedPct: number | null;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  bestReturnPct: number | null;
  worstReturnPct: number | null;
  /** Unix seconds of the most recent occurrence (including ones too recent to score). */
  lastSeen: number | null;
}

export interface TrackRecord {
  horizon: number;
  /** Share of all N-candle windows in this history that ended higher, %. */
  baseUpPct: number | null;
  /** Average N-candle return over the whole history, %. */
  baseAvgPct: number | null;
  years: number;
  candles: number;
  records: PatternRecord[];
}

const pct = (a: number, b: number) => (b / a - 1) * 100;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Entry at the close of the candle that completes the pattern; exit at the close N candles later. */
export function trackRecord(candles: Candle[], horizon = 5): TrackRecord {
  const n = candles.length;
  const returns: number[] = [];
  for (let i = 0; i + horizon < n; i++) returns.push(pct(candles[i].c, candles[i + horizon].c));

  const hits = detectPatterns(candles);
  const by = new Map<PatternId, { rets: number[]; last: number | null }>();
  for (const id of Object.keys(PATTERN_BIAS) as PatternId[]) by.set(id, { rets: [], last: null });
  for (const h of hits) {
    const g = by.get(h.pattern)!;
    g.last = Math.max(g.last ?? 0, h.t);
    if (h.index + horizon < n) g.rets.push(pct(candles[h.index].c, candles[h.index + horizon].c));
  }

  const records: PatternRecord[] = [...by.entries()].map(([pattern, g]) => {
    const bias = PATTERN_BIAS[pattern];
    const worked = g.rets.filter((r) => (bias === 'bearish' ? r < 0 : r > 0)).length;
    return {
      pattern,
      bias,
      count: g.rets.length,
      workedPct: g.rets.length ? (worked / g.rets.length) * 100 : null,
      avgReturnPct: g.rets.length ? g.rets.reduce((a, r) => a + r, 0) / g.rets.length : null,
      medianReturnPct: median(g.rets),
      bestReturnPct: g.rets.length ? Math.max(...g.rets) : null,
      worstReturnPct: g.rets.length ? Math.min(...g.rets) : null,
      lastSeen: g.last,
    };
  });

  return {
    horizon,
    baseUpPct: returns.length ? (returns.filter((r) => r > 0).length / returns.length) * 100 : null,
    baseAvgPct: returns.length ? returns.reduce((a, r) => a + r, 0) / returns.length : null,
    years: n > 1 ? (candles[n - 1].t - candles[0].t) / (365.25 * 86400) : 0,
    candles: n,
    records,
  };
}

/**
 * How the pattern compares with the stock's normal behaviour, in plain words. For a bearish
 * pattern the base rate is the share of windows that ended lower.
 */
export function verdict(r: PatternRecord, t: TrackRecord): 'better' | 'similar' | 'worse' | 'too few' {
  if (r.count < 15 || r.workedPct == null || t.baseUpPct == null) return 'too few';
  const base = r.bias === 'bearish' ? 100 - t.baseUpPct : t.baseUpPct;
  const d = r.workedPct - base;
  return d >= 5 ? 'better' : d <= -5 ? 'worse' : 'similar';
}
