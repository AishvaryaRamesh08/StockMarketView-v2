import { useEffect, useRef } from 'react';
import { INTERVALS, PERIODS, unsupportedReason, type IntervalId, type PeriodId } from '../lib/ranges.ts';

const INTERVAL_NAMES: Record<IntervalId, string> = {
  '1m': '1 min',
  '2m': '2 min',
  '5m': '5 min',
  '15m': '15 min',
  '30m': '30 min',
  '60m': '1 hour',
  '1d': 'Daily',
  '1wk': 'Weekly',
  '1mo': 'Monthly',
};

interface Props {
  period: PeriodId;
  interval: IntervalId;
  onPeriod: (p: PeriodId) => void;
  onInterval: (i: IntervalId) => void;
}

export function ChartToolbar({ period, interval, onPeriod, onInterval }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  // On narrow screens the chip rows scroll sideways; keep the selected chips in view.
  useEffect(() => {
    bar.current?.querySelectorAll<HTMLElement>('.chip.active').forEach((el) => {
      const row = el.parentElement!;
      const left = el.offsetLeft - row.offsetLeft;
      if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollTo({ left: left - row.clientWidth / 2 + el.offsetWidth / 2 });
      }
    });
  }, [period, interval]);

  return (
    <div className="chart-toolbar" ref={bar}>
      <div className="chip-group" role="radiogroup" aria-label="Time period">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={p.id === period}
            className={`chip ${p.id === period ? 'active' : ''}`}
            onClick={() => onPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* A dropdown rather than nine chips: the period is what people change most. */}
      <label className="chip-group interval-select" title="Candle interval: how much time each candle covers">
        <span className="visually-hidden">Candle interval</span>
        <select value={interval} onChange={(e) => onInterval(e.target.value as IntervalId)}>
          {INTERVALS.map((i) => {
            const reason = unsupportedReason(period, i.id);
            return (
              <option key={i.id} value={i.id} disabled={reason != null}>
                {INTERVAL_NAMES[i.id]}
                {reason ? ' (n/a)' : ''}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}
