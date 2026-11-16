import { memo, useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts';
import { diffTail } from '../lib/candles.ts';
import { tzOffsetMs } from '../lib/markets.ts';
import { formatPrice, formatVolume } from '../lib/format.ts';
import type { Candle } from '../lib/types.ts';

interface Props {
  candles: Candle[];
  /** Changes whenever the series is replaced (new symbol/period/interval) so the view refits. */
  version: string;
  timezone: string;
  currency: string;
  digits: number;
  intraday: boolean;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Lightweight Charts draws timestamps as UTC. Shift each bar by its exchange's UTC offset so
 * the axis reads in exchange time (09:15 IST, 09:30 ET). The offset is cached per day, which
 * is exact during trading hours because DST changes happen overnight on weekends.
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

function PriceChartImpl({ candles, version, timezone, currency, digits, intraday }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const drawn = useRef<{ version: string; candles: Candle[] }>({ version: '', candles: [] });
  /** The series version we last zoomed to fit. Fitting waits until that series has data. */
  const fittedVersion = useRef('');
  const byTime = useRef(new Map<number, Candle>());
  const fmt = useRef({ currency, digits });
  fmt.current = { currency, digits };

  // Create the chart once.
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
      },
      grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderVisible: false, rightOffset: 6, minBarSpacing: 1.5 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: cssVar('--crosshair'), labelBackgroundColor: cssVar('--surface-3') },
        horzLine: { color: cssVar('--crosshair'), labelBackgroundColor: cssVar('--surface-3') },
      },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const onMove = (p: MouseEventParams) => {
      const t = p.time as number | undefined;
      renderLegend(t != null ? byTime.current.get(t) : undefined);
    };
    chart.subscribeCrosshairMove(onMove);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      drawn.current = { version: '', candles: [] };
      fittedVersion.current = '';
    };
  }, []);

  function renderLegend(c: Candle | undefined) {
    const el = legend.current;
    if (!el) return;
    const bar = c ?? drawn.current.candles[drawn.current.candles.length - 1];
    if (!bar) {
      el.textContent = '';
      return;
    }
    const { currency: cur, digits: d } = fmt.current;
    const p = (v: number) => formatPrice(v, cur, d, false);
    const dir = bar.c >= bar.o ? 'up' : 'down';
    el.innerHTML =
      `<span>O <b class="${dir}">${p(bar.o)}</b></span><span>H <b class="${dir}">${p(bar.h)}</b></span>` +
      `<span>L <b class="${dir}">${p(bar.l)}</b></span><span>C <b class="${dir}">${p(bar.c)}</b></span>` +
      `<span>Vol <b>${formatVolume(bar.v, cur)}</b></span>`;
  }

  // Precision and axis format follow the instrument.
  useEffect(() => {
    candleRef.current?.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: 1 / 10 ** digits } });
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } });
  }, [digits, intraday]);

  // Push data: full reset for a new series, cheap tail updates for live refreshes.
  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!candle || !volume || !chart) return;

    const shift = makeShifter(timezone);
    const up = cssVar('--up-vol');
    const down = cssVar('--down-vol');
    const toBar = (c: Candle): CandlestickData => ({ time: shift(c.t), open: c.o, high: c.h, low: c.l, close: c.c });
    const toVol = (c: Candle): HistogramData => ({ time: shift(c.t), value: c.v, color: c.c >= c.o ? up : down });

    const prev = drawn.current;
    const diff = prev.version === version ? diffTail(prev.candles, candles) : ({ kind: 'reset' } as const);

    if (diff.kind === 'reset') {
      candle.setData(candles.map(toBar));
      volume.setData(candles.map(toVol));
      byTime.current = new Map(candles.map((c) => [shift(c.t) as number, c]));
      if (fittedVersion.current !== version && candles.length > 0) {
        chart.timeScale().fitContent();
        fittedVersion.current = version;
      }
    } else {
      for (const c of diff.bars) {
        candle.update(toBar(c));
        volume.update(toVol(c));
        byTime.current.set(shift(c.t), c);
      }
    }
    drawn.current = { version, candles };
    renderLegend(undefined);
  }, [candles, version, timezone]);

  return (
    <div className="chart">
      <div className="chart-legend" ref={legend} aria-live="off" />
      <div className="chart-canvas" ref={host} />
    </div>
  );
}

export const PriceChart = memo(PriceChartImpl);
