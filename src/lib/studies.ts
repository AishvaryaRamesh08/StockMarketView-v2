/**
 * Turns the active overlays into drawable series specs. Pure data, so the chart component only
 * has to draw, and the same values feed the hover legend.
 */
import { bollinger, ema, ichimoku, macd, parabolicSar, rsi, sma, vwap, type Series } from './indicators.ts';
import { OVERLAY_BY_ID, type IndicatorId, type OverlayId } from './overlays.ts';
import type { Candle } from './types.ts';

export type Pane = 'main' | 'rsi' | 'macd';

export interface StudySpec {
  /** Stable id for the drawn series, e.g. "bb.upper". */
  key: string;
  /** Overlay this belongs to (for the legend). */
  overlay: IndicatorId;
  label: string;
  kind: 'line' | 'dots' | 'histogram';
  pane: Pane;
  color: string;
  width?: 1 | 2;
  dashed?: boolean;
  /** Aligned with the candles; may be longer (Ichimoku's projected cloud). */
  values: Series;
  /** Per-value colours for histograms. */
  colors?: string[];
  /** Show the value in the legend (false for secondary lines such as band edges). */
  inLegend?: boolean;
}

export const OSCILLATOR_PANES: Pane[] = ['rsi', 'macd'];

export function buildStudies(candles: Candle[], active: ReadonlySet<OverlayId>, opts: { intraday: boolean; sessionOf: (t: number) => string; up: string; down: string }): StudySpec[] {
  const specs: StudySpec[] = [];
  if (candles.length === 0) return specs;
  const closes = candles.map((c) => c.c);
  const on = (id: IndicatorId) => {
    if (!active.has(id)) return false;
    const def = OVERLAY_BY_ID.get(id)!;
    if (def.intradayOnly && !opts.intraday) return false;
    return candles.length >= (def.minBars ?? 1);
  };
  const color = (id: IndicatorId) => OVERLAY_BY_ID.get(id)!.color;

  for (const [id, n] of [['sma20', 20], ['sma50', 50], ['sma100', 100], ['sma200', 200]] as const) {
    if (on(id)) specs.push({ key: id, overlay: id, label: `SMA ${n}`, kind: 'line', pane: 'main', color: color(id), width: 2, values: sma(closes, n), inLegend: true });
  }
  for (const [id, n] of [['ema9', 9], ['ema21', 21]] as const) {
    if (on(id)) specs.push({ key: id, overlay: id, label: `EMA ${n}`, kind: 'line', pane: 'main', color: color(id), width: 2, values: ema(closes, n), inLegend: true });
  }
  if (on('bb')) {
    const b = bollinger(closes);
    const c = color('bb');
    specs.push({ key: 'bb.upper', overlay: 'bb', label: 'BB upper', kind: 'line', pane: 'main', color: c, width: 1, values: b.upper, inLegend: true });
    specs.push({ key: 'bb.middle', overlay: 'bb', label: 'BB mid', kind: 'line', pane: 'main', color: c, width: 1, dashed: true, values: b.middle });
    specs.push({ key: 'bb.lower', overlay: 'bb', label: 'BB lower', kind: 'line', pane: 'main', color: c, width: 1, values: b.lower, inLegend: true });
  }
  if (on('ichimoku')) {
    const ich = ichimoku(candles);
    specs.push({ key: 'ich.tenkan', overlay: 'ichimoku', label: 'Tenkan', kind: 'line', pane: 'main', color: '#4fc3f7', width: 1, values: ich.tenkan, inLegend: true });
    specs.push({ key: 'ich.kijun', overlay: 'ichimoku', label: 'Kijun', kind: 'line', pane: 'main', color: '#e57373', width: 1, values: ich.kijun, inLegend: true });
    specs.push({ key: 'ich.spanA', overlay: 'ichimoku', label: 'Span A', kind: 'line', pane: 'main', color: '#66bb6a', width: 1, values: ich.senkouA });
    specs.push({ key: 'ich.spanB', overlay: 'ichimoku', label: 'Span B', kind: 'line', pane: 'main', color: '#ef5350', width: 1, values: ich.senkouB });
  }
  if (on('psar')) {
    specs.push({ key: 'psar', overlay: 'psar', label: 'SAR', kind: 'dots', pane: 'main', color: color('psar'), values: parabolicSar(candles), inLegend: true });
  }
  if (on('vwap')) {
    specs.push({ key: 'vwap', overlay: 'vwap', label: 'VWAP', kind: 'line', pane: 'main', color: color('vwap'), width: 2, values: vwap(candles, opts.sessionOf), inLegend: true });
  }
  if (on('rsi')) {
    specs.push({ key: 'rsi', overlay: 'rsi', label: 'RSI 14', kind: 'line', pane: 'rsi', color: color('rsi'), width: 2, values: rsi(closes, 14), inLegend: true });
  }
  if (on('macd')) {
    const m = macd(closes);
    specs.push({
      key: 'macd.hist',
      overlay: 'macd',
      label: 'Hist',
      kind: 'histogram',
      pane: 'macd',
      color: opts.up,
      values: m.histogram,
      colors: m.histogram.map((h, i) => {
        const prev = m.histogram[i - 1];
        const rising = prev == null || h == null || h >= prev;
        return (h ?? 0) >= 0 ? (rising ? opts.up : `${opts.up}80`) : rising ? `${opts.down}80` : opts.down;
      }),
    });
    specs.push({ key: 'macd.line', overlay: 'macd', label: 'MACD', kind: 'line', pane: 'macd', color: '#5b8cff', width: 2, values: m.macd, inLegend: true });
    specs.push({ key: 'macd.signal', overlay: 'macd', label: 'Signal', kind: 'line', pane: 'macd', color: '#ff9f43', width: 1, values: m.signal, inLegend: true });
  }
  return specs;
}

/**
 * Timestamps for bars that don't exist yet (Ichimoku projects 26 bars ahead). Uses the
 * typical bar spacing, and skips weekends for daily bars.
 */
export function futureTimes(candles: Candle[], count: number, daily: boolean): number[] {
  if (candles.length < 2 || count <= 0) return [];
  const diffs = [];
  for (let i = Math.max(1, candles.length - 20); i < candles.length; i++) diffs.push(candles[i].t - candles[i - 1].t);
  diffs.sort((a, b) => a - b);
  const step = diffs[Math.floor(diffs.length / 2)] || 86400;
  const out: number[] = [];
  let t = candles[candles.length - 1].t;
  while (out.length < count) {
    t += daily ? 86400 : step;
    if (daily) {
      const wd = new Date(t * 1000).getUTCDay();
      if (wd === 0 || wd === 6) continue;
    }
    out.push(t);
  }
  return out;
}
