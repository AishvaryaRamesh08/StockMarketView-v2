import { memo, useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';
import { diffTail } from '../lib/candles.ts';
import { CloudPrimitive, type CloudPoint } from './cloudPrimitive.ts';
import { DrawingController, type TextRequest } from './drawingController.ts';
import type { DrawTool, Drawing } from '../lib/drawings.ts';
import { sessionKeyFn, tzOffsetMs } from '../lib/markets.ts';
import { formatPrice, formatVolume } from '../lib/format.ts';
import { PATTERN_BIAS, detectPatterns, type Bias, type PatternId } from '../lib/patterns.ts';
import { cssVar, useAppearanceKey } from '../lib/theme.ts';
import { OVERLAY_BY_ID, PATTERN_IDS, PATTERN_SHORT, type OverlayId } from '../lib/overlays.ts';
import { OSCILLATOR_PANES, buildStudies, futureTimes, type StudySpec } from '../lib/studies.ts';
import type { Level } from '../lib/levels.ts';
import type { Candle, CorporateEvent } from '../lib/types.ts';

export interface CompareLine {
  symbol: string;
  label: string;
  color: string;
  timezone: string;
  candles: Candle[];
}

interface Props {
  candles: Candle[];
  /** Changes whenever the series is replaced (new symbol/period/interval) so the view refits. */
  version: string;
  timezone: string;
  currency: string;
  digits: number;
  intraday: boolean;
  overlays?: ReadonlySet<OverlayId>;
  events?: CorporateEvent[];
  levels?: Level[];
  compare?: CompareLine[];
  /** True while the last candle is still forming; patterns are only marked on completed candles. */
  lastBarLive?: boolean;
  /** Charts sharing a group move their crosshairs together (multi-timeframe view). */
  syncGroup?: string;
  /** Smaller legend for side-by-side panes. */
  compact?: boolean;
  /** Drawing layer; omit to show no drawings (multi-timeframe panes). */
  drawing?: DrawingProps;
  /** Receives a function that captures the chart as a canvas, for image export. */
  onScreenshotReady?: (capture: (() => HTMLCanvasElement) | null) => void;
  /** Paper-trading fills to mark, and working orders / average cost to draw as lines. */
  trades?: TradeMark[];
  tradeLines?: TradeLine[];
  /** On a new series, show only the last this-many candles instead of fitting everything (replay). */
  initialBars?: number;
}

export interface TradeMark {
  /** Unix seconds of the fill. */
  t: number;
  side: 'buy' | 'sell';
  qty: number;
}

export interface TradeLine {
  price: number;
  title: string;
  kind: 'buy' | 'sell' | 'avg';
}

export interface DrawingProps {
  drawings: Drawing[];
  tool: DrawTool | null;
  selectedId: string | null;
  onCommit: (next: Drawing[]) => void;
  onSelect: (id: string | null) => void;
  onToolDone: () => void;
  onTextRequest: (req: TextRequest) => void;
}


/**
 * Lightweight Charts draws timestamps as UTC. Shift each bar by its exchange's UTC offset so
 * the axis reads in exchange time (09:15 IST, 09:30 ET). Cached per day, which is exact during
 * trading hours because DST changes happen overnight on weekends.
 */
function makeShifter(tz: string) {
  const cache = new Map<number, number>();
  return (t: number): UTCTimestamp => {
    const day = Math.floor(t / 86400);
    let off = cache.get(day);
    if (off === undefined) {
      off = tzOffsetMs(tz, new Date(t * 1000)) / 1000;
      cache.set(day, off);
    }
    return (t + off) as UTCTimestamp;
  };
}

/** Last index whose time is <= t (binary search), or -1. */
function indexAtOrBefore(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/* ------------------------------- crosshair sync ------------------------------- */

type SyncListener = { id: object; onMove: (t: number | null) => void };
const syncBuses = new Map<string, Set<SyncListener>>();

function publish(group: string, from: object, t: number | null) {
  for (const l of syncBuses.get(group) ?? []) if (l.id !== from) l.onMove(t);
}

/* -------------------------------------------------------------------------------- */

const LEVEL_STYLE: Record<Level['kind'], { color: string; style: LineStyle; title: string }> = {
  high52: { color: '#9aa4b5', style: LineStyle.Dotted, title: '52W high' },
  low52: { color: '#9aa4b5', style: LineStyle.Dotted, title: '52W low' },
  prevHigh: { color: '#f0b429', style: LineStyle.Dashed, title: 'Prev high' },
  prevLow: { color: '#f0b429', style: LineStyle.Dashed, title: 'Prev low' },
  resistance: { color: '#f2555a', style: LineStyle.Dashed, title: 'Resistance' },
  support: { color: '#22c38e', style: LineStyle.Dashed, title: 'Support' },
};

// Stable defaults: a fresh `[]` per render would re-run the effects below on every render.
/** Bullish/bearish things follow the theme's up/down colours (which the colour-blind palette changes). */
function biasColor(bias: Bias, neutral: string): string {
  return bias === 'bullish' ? cssVar('--up') : bias === 'bearish' ? cssVar('--down') : neutral;
}

const EMPTY_SET: ReadonlySet<OverlayId> = new Set();
const NO_EVENTS: CorporateEvent[] = [];
const NO_LEVELS: Level[] = [];
const NO_COMPARE: CompareLine[] = [];
const NO_TRADES: TradeMark[] = [];
const NO_TRADE_LINES: TradeLine[] = [];

function PriceChartImpl({
  candles,
  version,
  timezone,
  currency,
  digits,
  intraday,
  overlays = EMPTY_SET,
  events = NO_EVENTS,
  levels = NO_LEVELS,
  compare = NO_COMPARE,
  lastBarLive = false,
  syncGroup,
  compact = false,
  drawing,
  onScreenshotReady,
  trades = NO_TRADES,
  tradeLines = NO_TRADE_LINES,
  initialBars,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const studySeries = useRef(new Map<string, { api: ISeriesApi<SeriesType>; paneIndex: number }>());
  const priceLines = useRef<IPriceLine[]>([]);
  const compareSeries = useRef(new Map<string, ISeriesApi<'Line'>>());
  const drawn = useRef<{ version: string; candles: Candle[] }>({ version: '', candles: [] });
  const fittedVersion = useRef('');
  const byTime = useRef(new Map<number, number>()); // shifted time -> candle index
  const studiesRef = useRef<StudySpec[]>([]);
  const compareRef = useRef<CompareLine[]>([]);
  const patternsAt = useRef(new Map<number, PatternId[]>());
  const cloudRef = useRef<CloudPrimitive | null>(null);
  const controllerRef = useRef<DrawingController | null>(null);
  const timesRef = useRef<number[]>([]);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const drawingEnabled = !!drawing;
  const applyingSync = useRef(false);
  const fmt = useRef({ currency, digits, compact });
  fmt.current = { currency, digits, compact };

  const shift = useMemo(() => makeShifter(timezone), [timezone]);
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const overlayKey = [...overlays].sort().join(',');

  /* ------------------------------ legend ------------------------------ */
  function renderLegend(index: number | undefined) {
    const el = legend.current;
    if (!el) return;
    const cs = drawn.current.candles;
    const i = index ?? cs.length - 1;
    const bar = cs[i];
    if (!bar) {
      el.innerHTML = '';
      return;
    }
    const { currency: cur, digits: d, compact: small } = fmt.current;
    const p = (v: number) => formatPrice(v, cur, d, false);
    const dir = bar.c >= bar.o ? 'up' : 'down';
    let html =
      `<div class="lg-row"><span>O <b class="${dir}">${p(bar.o)}</b></span><span>H <b class="${dir}">${p(bar.h)}</b></span>` +
      `<span>L <b class="${dir}">${p(bar.l)}</b></span><span>C <b class="${dir}">${p(bar.c)}</b></span>` +
      (small ? '' : `<span>Vol <b>${formatVolume(bar.v, cur)}</b></span>`) +
      `</div>`;
    const items: string[] = [];
    for (const s of studiesRef.current) {
      if (!s.inLegend || s.pane !== 'main') continue;
      const v = s.values[i];
      items.push(`<span class="lg-item"><i style="background:${s.color}"></i>${s.label} <b>${v == null ? '—' : p(v)}</b></span>`);
    }
    for (const c of compareRef.current) {
      const ci = indexAtOrBefore(c.candles, bar.t);
      const base = c.candles[0]?.c;
      const v = ci >= 0 && base ? ((c.candles[ci].c - base) / base) * 100 : null;
      items.push(`<span class="lg-item"><i style="background:${c.color}"></i>${c.label} <b>${v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}</b></span>`);
    }
    if (items.length && !small) html += `<div class="lg-row">${items.join('')}</div>`;
    const pats = patternsAt.current.get(i);
    if (pats?.length) {
      html += `<div class="lg-row">${pats
        .map((id) => {
          const def = OVERLAY_BY_ID.get(id)!;
          const bias = PATTERN_BIAS[id];
          return `<span class="lg-pattern" style="color:${biasColor(bias, def.color)}">${bias === 'bullish' ? '▲' : bias === 'bearish' ? '▼' : '●'} ${def.label}</span>`;
        })
        .join('')}</div>`;
    }
    el.innerHTML = html;
  }

  /* --------------------------- create chart once --------------------------- */
  useEffect(() => {
    const el = host.current!;
    const up = cssVar('--up');
    const down = cssVar('--down');
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: cssVar('--text-2'),
        fontFamily: cssVar('--font-sans'),
        fontSize: 12,
        attributionLogo: true,
        panes: { separatorColor: cssVar('--border'), separatorHoverColor: cssVar('--border-strong') },
      },
      grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
      // Keep the same date range in view when the window or sidebar changes width.
      timeScale: { borderVisible: false, rightOffset: 6, minBarSpacing: 1.5, lockVisibleTimeRangeOnResize: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: cssVar('--crosshair'), labelBackgroundColor: cssVar('--surface-3') },
        horzLine: { color: cssVar('--crosshair'), labelBackgroundColor: cssVar('--surface-3') },
      },
    });
    const candle = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    markersRef.current = createSeriesMarkers(candle, []);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      studySeries.current.clear();
      cloudRef.current = null;
      compareSeries.current.clear();
      priceLines.current = [];
      drawn.current = { version: '', candles: [] };
      fittedVersion.current = '';
    };
  }, []);

  /* ------------------- crosshair: legend + multi-chart sync ------------------- */
  useEffect(() => {
    const chart = chartRef.current!;
    const me = {};
    const onMove = (p: MouseEventParams) => {
      const idx = p.time != null ? byTime.current.get(p.time as number) : undefined;
      renderLegend(idx);
      if (!syncGroup || applyingSync.current) return;
      publish(syncGroup, me, idx != null ? drawn.current.candles[idx].t : null);
    };
    chart.subscribeCrosshairMove(onMove);

    let listener: SyncListener | undefined;
    if (syncGroup) {
      listener = {
        id: me,
        onMove: (t) => {
          const series = candleRef.current;
          if (!series) return;
          applyingSync.current = true;
          try {
            const cs = drawn.current.candles;
            const i = t == null ? -1 : indexAtOrBefore(cs, t);
            if (i < 0) {
              chart.clearCrosshairPosition();
              renderLegend(undefined);
            } else {
              chart.setCrosshairPosition(cs[i].c, shiftRef.current(cs[i].t), series);
              renderLegend(i);
            }
          } finally {
            applyingSync.current = false;
          }
        },
      };
      if (!syncBuses.has(syncGroup)) syncBuses.set(syncGroup, new Set());
      syncBuses.get(syncGroup)!.add(listener);
    }
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      if (listener && syncGroup) syncBuses.get(syncGroup)?.delete(listener);
    };
  }, [syncGroup]);

  /* ---------------------------- instrument format ---------------------------- */
  useEffect(() => {
    const fmtOpts = { type: 'price' as const, precision: digits, minMove: 1 / 10 ** digits };
    candleRef.current?.applyOptions({ priceFormat: fmtOpts });
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } });
  }, [digits, intraday]);

  /* ------------------------------- candles ------------------------------- */
  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!candle || !volume || !chart) return;

    const upVol = cssVar('--up-vol');
    const downVol = cssVar('--down-vol');
    const toBar = (c: Candle): CandlestickData => ({ time: shift(c.t), open: c.o, high: c.h, low: c.l, close: c.c });
    const toVol = (c: Candle): HistogramData => ({ time: shift(c.t), value: c.v, color: c.c >= c.o ? upVol : downVol });

    const prev = drawn.current;
    const diff = prev.version === version ? diffTail(prev.candles, candles) : ({ kind: 'reset' } as const);
    if (diff.kind === 'reset') {
      candle.setData(candles.map(toBar));
      volume.setData(candles.map(toVol));
    } else {
      for (const c of diff.bars) {
        candle.update(toBar(c));
        volume.update(toVol(c));
      }
    }
    byTime.current = new Map(candles.map((c, i) => [shift(c.t) as number, i]));
    drawn.current = { version, candles };
    timesRef.current = candles.map((c) => c.t);
    controllerRef.current?.refresh();
    // Refit for a new series, or when a refresh replaced it with a different span (new trading day).
    const rolledOver = prev.version === version && prev.candles.length > 0 && candles.length > 0 && prev.candles[0].t !== candles[0].t;
    if ((fittedVersion.current !== version || rolledOver) && candles.length > 0) {
      if (initialBars && candles.length > initialBars) chart.timeScale().setVisibleLogicalRange({ from: candles.length - initialBars, to: candles.length + 3 });
      else chart.timeScale().fitContent();
      fittedVersion.current = version;
    }
    renderLegend(undefined);
  }, [candles, version, shift, initialBars]);

  /* ------------------------------- studies ------------------------------- */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const specs = buildStudies(candles, overlays, { intraday, sessionOf: sessionKeyFn(timezone), up: cssVar('--up'), down: cssVar('--down') });
    studiesRef.current = specs;

    // Oscillators each get their own pane, in a fixed order, below the price pane.
    const activePanes = OSCILLATOR_PANES.filter((p) => specs.some((s) => s.pane === p));
    const paneIndexOf = (s: StudySpec) => (s.pane === 'main' ? 0 : 1 + activePanes.indexOf(s.pane));

    // Remove series that are no longer wanted or must move pane.
    const wanted = new Map(specs.map((s) => [s.key, paneIndexOf(s)]));
    for (const [key, entry] of studySeries.current) {
      if (wanted.get(key) !== entry.paneIndex) {
        chart.removeSeries(entry.api);
        studySeries.current.delete(key);
      }
    }
    // Drop panes left empty (never the price pane).
    const panes = chart.panes();
    for (let i = panes.length - 1; i > 0; i--) if (panes[i].getSeries().length === 0) chart.removePane(i);

    const times = candles.map((c) => shift(c.t));
    const longest = Math.max(0, ...specs.map((s) => s.values.length));
    const extra = futureTimes(candles, longest - candles.length, !intraday).map(shift);
    const allTimes = [...times, ...extra];

    for (const s of specs) {
      let entry = studySeries.current.get(s.key);
      const paneIndex = paneIndexOf(s);
      if (!entry) {
        const common = { lastValueVisible: s.pane !== 'main', priceLineVisible: false, crosshairMarkerVisible: s.kind === 'line', title: s.pane === 'main' ? '' : s.label };
        const api =
          s.kind === 'histogram'
            ? chart.addSeries(HistogramSeries, { ...common, color: s.color }, paneIndex)
            : chart.addSeries(
                LineSeries,
                {
                  ...common,
                  color: s.color,
                  lineWidth: s.width ?? 1,
                  lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
                  lineVisible: s.kind !== 'dots',
                  pointMarkersVisible: s.kind === 'dots',
                  pointMarkersRadius: 1.6,
                },
                paneIndex,
              );
        if (s.key === 'rsi') {
          for (const level of [70, 30]) api.createPriceLine({ price: level, color: cssVar('--text-3'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
          api.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
        }
        entry = { api: api as ISeriesApi<SeriesType>, paneIndex };
        studySeries.current.set(s.key, entry);
      }
      const data: (LineData | HistogramData | WhitespaceData)[] = [];
      for (let i = 0; i < s.values.length && i < allTimes.length; i++) {
        const v = s.values[i];
        if (v == null) data.push({ time: allTimes[i] });
        else if (s.colors) data.push({ time: allTimes[i], value: v, color: s.colors[i] });
        else data.push({ time: allTimes[i], value: v });
      }
      entry.api.setData(data as never);
    }

    // Ichimoku: shade the cloud between span A and span B.
    const spanA = specs.find((x) => x.key === 'ich.spanA');
    const spanB = specs.find((x) => x.key === 'ich.spanB');
    const candleSeries = candleRef.current;
    if (spanA && spanB && candleSeries) {
      const points: CloudPoint[] = [];
      for (let i = 0; i < spanA.values.length && i < allTimes.length; i++) {
        const a = spanA.values[i];
        const b = spanB.values[i];
        if (a != null && b != null) points.push({ time: allTimes[i], a, b });
      }
      if (!cloudRef.current) {
        cloudRef.current = new CloudPrimitive();
        candleSeries.attachPrimitive(cloudRef.current);
      }
      cloudRef.current.setData(points, cssVar('--up-soft'), cssVar('--down-soft'));
    } else if (cloudRef.current && candleSeries) {
      candleSeries.detachPrimitive(cloudRef.current);
      cloudRef.current = null;
    }

    const finalPanes = chart.panes();
    finalPanes[0]?.setStretchFactor(3);
    for (let i = 1; i < finalPanes.length; i++) finalPanes[i].setStretchFactor(1);
    renderLegend(undefined);
  }, [candles, overlayKey, intraday, timezone, shift]);

  /* --------------------------- pattern & event markers --------------------------- */
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    const active = new Set(PATTERN_IDS.filter((p) => overlays.has(p)));
    const out: SeriesMarker<Time>[] = [];
    const byIndex = new Map<number, PatternId[]>();
    if (active.size) {
      const completed = lastBarLive ? candles.slice(0, -1) : candles;
      const hits = detectPatterns(completed, active as ReadonlySet<PatternId>);
      // Label only the most recent few; older ones are arrows (named in the legend on hover),
      // otherwise a year of daily candles turns into a wall of overlapping text.
      const labelled = new Set(hits.slice(-3));
      for (const hit of hits) {
        const def = OVERLAY_BY_ID.get(hit.pattern)!;
        byIndex.set(hit.index, [...(byIndex.get(hit.index) ?? []), hit.pattern]);
        out.push({
          time: shift(hit.t),
          position: hit.bias === 'bullish' ? 'belowBar' : 'aboveBar',
          shape: hit.bias === 'bullish' ? 'arrowUp' : hit.bias === 'bearish' ? 'arrowDown' : 'circle',
          color: biasColor(hit.bias, def.color),
          text: labelled.has(hit) ? PATTERN_SHORT[hit.pattern] : undefined,
        });
      }
    }
    patternsAt.current = byIndex;
    if (overlays.has('dividends') && candles.length) {
      for (const e of events) {
        const i = indexAtOrBefore(candles, e.t);
        if (i < 0 || e.t < candles[0].t) continue;
        out.push({
          time: shift(candles[i].t),
          position: 'belowBar',
          shape: 'circle',
          color: e.kind === 'dividend' ? '#8b95a8' : '#f0b429',
          text: e.kind === 'dividend' ? 'D' : `S ${e.value}`,
          size: 0.6,
        });
      }
    }
    // Paper-trading fills, on the candle each one happened in.
    if (candles.length) {
      const accent = cssVar('--accent');
      for (const tr of trades) {
        const i = indexAtOrBefore(candles, tr.t);
        if (i < 0 || tr.t < candles[0].t) continue;
        out.push({
          time: shift(candles[i].t),
          position: tr.side === 'buy' ? 'belowBar' : 'aboveBar',
          shape: tr.side === 'buy' ? 'arrowUp' : 'arrowDown',
          color: accent,
          text: `${tr.side === 'buy' ? 'B' : 'S'} ${tr.qty}`,
        });
      }
    }
    out.sort((a, b) => (a.time as number) - (b.time as number));
    markers.setMarkers(out);
  }, [candles, overlayKey, events, lastBarLive, shift, trades]);

  /* ------------------------ paper-trading order lines ------------------------ */
  const tradeLineRefs = useRef<IPriceLine[]>([]);
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    for (const l of tradeLineRefs.current) candle.removePriceLine(l);
    tradeLineRefs.current = tradeLines.map((l) =>
      candle.createPriceLine({
        price: l.price,
        color: l.kind === 'avg' ? cssVar('--text-2') : cssVar('--accent'),
        lineStyle: l.kind === 'avg' ? LineStyle.Solid : LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
  }, [tradeLines]);

  /* ------------------------------- key levels ------------------------------- */
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    for (const l of priceLines.current) candle.removePriceLine(l);
    priceLines.current = levels.map((l) => {
      const st = LEVEL_STYLE[l.kind];
      const color = l.kind === 'resistance' ? cssVar('--down') : l.kind === 'support' ? cssVar('--up') : st.color;
      return candle.createPriceLine({ price: l.price, color, lineStyle: st.style, lineWidth: 1, axisLabelVisible: true, title: st.title });
    });
  }, [levels]);

  /* ------------------------------- compare ------------------------------- */
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle) return;
    compareRef.current = compare;
    const want = new Set(compare.map((c) => c.symbol));
    for (const [sym, api] of compareSeries.current) {
      if (!want.has(sym)) {
        chart.removeSeries(api);
        compareSeries.current.delete(sym);
      }
    }
    for (const c of compare) {
      let api = compareSeries.current.get(c.symbol);
      if (!api) {
        api = chart.addSeries(LineSeries, { color: c.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: c.label });
        compareSeries.current.set(c.symbol, api);
      }
      const sh = makeShifter(c.timezone);
      api.setData(c.candles.map((k) => ({ time: sh(k.t), value: k.c })));
    }
    // Percentage mode rebases every series to its first visible value: a fair comparison.
    candle.priceScale().applyOptions({ mode: compare.length ? PriceScaleMode.Percentage : PriceScaleMode.Normal });
    renderLegend(undefined);
  }, [compare]);

  /* ------------------------------- drawings ------------------------------- */
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!drawingEnabled || !chart || !series || !host.current) return;
    const ctl = new DrawingController({
      chart,
      series,
      host: host.current,
      times: () => timesRef.current,
      barX: (i) => {
        const c = drawn.current.candles[i];
        return c ? chart.timeScale().timeToCoordinate(shiftRef.current(c.t)) : null;
      },
      colors: () => ({ line: cssVar('--accent'), fill: cssVar('--accent-soft'), text: cssVar('--text-1'), labelBg: cssVar('--surface-1'), handle: cssVar('--border-strong') }),
      formatPrice: (p) => formatPrice(p, fmt.current.currency, fmt.current.digits, false),
      onCommit: (next) => drawingRef.current?.onCommit(next),
      onSelect: (id) => drawingRef.current?.onSelect(id),
      onToolDone: () => drawingRef.current?.onToolDone(),
      onTextRequest: (req) => drawingRef.current?.onTextRequest(req),
    });
    controllerRef.current = ctl;
    return () => {
      ctl.destroy();
      controllerRef.current = null;
    };
  }, [drawingEnabled]);

  useEffect(() => {
    if (drawing) controllerRef.current?.setState({ drawings: drawing.drawings, tool: drawing.tool, selectedId: drawing.selectedId });
  }, [drawing?.drawings, drawing?.tool, drawing?.selectedId]);

  /* --------------------------- image export hook --------------------------- */
  useEffect(() => {
    if (!onScreenshotReady) return;
    onScreenshotReady(() => {
      chartRef.current!.clearCrosshairPosition();
      return chartRef.current!.takeScreenshot(true, false);
    });
    return () => onScreenshotReady(null);
  }, [onScreenshotReady]);

  return (
    <div className={`chart ${compact ? 'compact' : ''}`}>
      <div className="chart-legend" ref={legend} aria-live="off" />
      <div className="chart-canvas" ref={host} />
    </div>
  );
}

const MemoChart = memo(PriceChartImpl);

/** Rebuilt when the theme or palette changes, because the canvas reads its colours once. */
export function PriceChart(props: Props) {
  const appearance = useAppearanceKey();
  return <MemoChart key={appearance} {...props} />;
}
