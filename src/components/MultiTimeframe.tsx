import { useMemo } from 'react';
import { useLiveChart } from '../hooks/useLiveChart.ts';
import { digitsFor } from '../lib/format.ts';
import { INTERVALS, PERIODS, intervalForPeriod, isIntraday, unsupportedReason, type IntervalId, type PeriodId } from '../lib/ranges.ts';
import type { OverlayId } from '../lib/overlays.ts';
import { PriceChart } from './PriceChart.tsx';

export interface Frame {
  period: PeriodId;
  interval: IntervalId;
}

export const DEFAULT_FRAMES: Frame[] = [
  { period: '5d', interval: '15m' },
  { period: '1mo', interval: '60m' },
  { period: '1y', interval: '1d' },
];

function Pane({ symbol, frame, index, overlays, onChange }: { symbol: string; frame: Frame; index: number; overlays: ReadonlySet<OverlayId>; onChange: (f: Frame) => void }) {
  const chart = useLiveChart(symbol, frame.period, frame.interval);
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
          candles={chart.candles}
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
export function MultiTimeframe({ symbol, frames, overlays, onFramesChange }: { symbol: string; frames: Frame[]; overlays: ReadonlySet<OverlayId>; onFramesChange: (f: Frame[]) => void }) {
  // Oscillator panes make three small charts unreadable; keep overlays that draw on price.
  const priceOverlays = useMemo(() => new Set([...overlays].filter((o) => o !== 'rsi' && o !== 'macd')), [overlays]);
  return (
    <div className="mtf">
      {frames.map((f, i) => (
        <Pane key={i} index={i} symbol={symbol} frame={f} overlays={priceOverlays} onChange={(nf) => onFramesChange(frames.map((x, j) => (j === i ? nf : x)))} />
      ))}
    </div>
  );
}
