import { useMemo } from 'react';
import { useLiveChart } from '../hooks/useLiveChart.ts';
import { digitsFor } from '../lib/format.ts';
import { INTERVALS, PERIODS, intervalForPeriod, isIntraday, unsupportedReason, type IntervalId, type PeriodId } from '../lib/ranges.ts';
import { foldQuote } from '../lib/candles.ts';
import type { Quote } from '../lib/types.ts';
import type { OverlayId } from '../lib/overlays.ts';
import { PriceChart } from './PriceChart.tsx';

import type { Frame } from '../lib/frames.ts';
export { DEFAULT_FRAMES, type Frame } from '../lib/frames.ts';

/**
 * Request budget: three panes polling every 30 s would be 6 requests a minute on their own.
 * Each pane refreshes its candles every minute (every 5 minutes for daily and longer), and the
 * page's batched quote poll moves the last candle every 30 s in between.
 */
export function panePollMs(interval: IntervalId): number {
  return isIntraday(interval) ? 60_000 : 5 * 60_000;
}

function Pane({ symbol, frame, index, overlays, quote, onChange }: { symbol: string; frame: Frame; index: number; overlays: ReadonlySet<OverlayId>; quote: Quote | null; onChange: (f: Frame) => void }) {
  const chart = useLiveChart(symbol, frame.period, frame.interval, { openPollMs: panePollMs(frame.interval) });
  const step = INTERVALS.find((i) => i.id === frame.interval)!.seconds;
  const candles = useMemo(() => foldQuote(chart.candles, quote?.price, quote?.marketTime, step), [chart.candles, quote?.price, quote?.marketTime, step]);
  const q = chart.quote;
  return (
    <div className="mtf-pane">
      <div className="mtf-head">
        <select value={frame.period} onChange={(e) => onChange({ period: e.target.value as PeriodId, interval: intervalForPeriod(e.target.value as PeriodId, frame.interval) })} aria-label={`Chart ${index + 1} period`}>
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={frame.interval} onChange={(e) => onChange({ ...frame, interval: e.target.value as IntervalId })} aria-label={`Chart ${index + 1} interval`}>
          {INTERVALS.map((i) => (
            <option key={i.id} value={i.id} disabled={!!unsupportedReason(frame.period, i.id)}>
              {i.label} candles
            </option>
          ))}
        </select>
      </div>
      <div className="mtf-chart">
        {chart.status === 'loading' && <div className="chart-skeleton skeleton" />}
        {chart.status === 'error' && (
          <div className="chart-message">
            <p>{chart.error}</p>
            <button className="btn" onClick={chart.retry}>
              Try again
            </button>
          </div>
        )}
        <PriceChart
          candles={candles}
          version={chart.version}
          timezone={q?.timezone ?? 'UTC'}
          currency={q?.currency ?? 'USD'}
          digits={digitsFor(q?.priceHint, q?.price ?? null)}
          intraday={isIntraday(frame.interval)}
          overlays={overlays}
          events={chart.events}
          lastBarLive={chart.marketOpen}
          syncGroup="mtf"
          compact
        />
      </div>
    </div>
  );
}

/** The same stock in three timeframes side by side; moving the crosshair on one moves all three. */
export function MultiTimeframe({ symbol, frames, overlays, quote, onFramesChange }: { symbol: string; frames: Frame[]; overlays: ReadonlySet<OverlayId>; quote: Quote | null; onFramesChange: (f: Frame[]) => void }) {
  // Oscillator panes make three small charts unreadable; keep overlays that draw on price.
  const priceOverlays = useMemo(() => new Set([...overlays].filter((o) => o !== 'rsi' && o !== 'macd')), [overlays]);
  return (
    <div className="mtf">
      {frames.map((f, i) => (
        <Pane key={i} index={i} symbol={symbol} frame={f} overlays={priceOverlays} quote={quote} onChange={(nf) => onFramesChange(frames.map((x, j) => (j === i ? nf : x)))} />
      ))}
    </div>
  );
}
