import { useEffect, useRef } from 'react';
import { INTERVALS, PERIODS, unsupportedReason, type IntervalId, type PeriodId } from '../lib/ranges.ts';

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
        <span className="chip-group-label">Period</span>
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
      <div className="chip-group" role="radiogroup" aria-label="Candle interval">
        <span className="chip-group-label">Interval</span>
        {INTERVALS.map((i) => {
          const reason = unsupportedReason(period, i.id);
          return (
            <button
              key={i.id}
              role="radio"
              aria-checked={i.id === interval}
              className={`chip ${i.id === interval ? 'active' : ''}`}
              disabled={reason != null}
              title={reason ?? undefined}
              onClick={() => onInterval(i.id)}
            >
              {i.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
