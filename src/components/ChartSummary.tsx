import { useMemo } from 'react';
import { summarize } from '../lib/summary.ts';
import type { IntervalId } from '../lib/ranges.ts';
import type { Candle } from '../lib/types.ts';
import { InfoTip } from './InfoTip.tsx';

/** "Above 50-day average · RSI 68 · Bearish engulfing 2 days ago", with hover explanations. */
export function ChartSummary({ candles, interval, high52 }: { candles: Candle[]; interval: IntervalId; high52: number | null | undefined }) {
  const parts = useMemo(() => summarize(candles, interval, high52), [candles, interval, high52]);
  if (!parts.length) return null;
  return (
    <p className="chart-summary" aria-label="Chart summary">
      <span className="summary-label">At a glance</span>
      {parts.map((p, i) => (
        <InfoTip key={p.text} text={p.hint}>
          <span className={`summary-part tone-${p.tone}`} tabIndex={0}>
            {i > 0 && <span className="sep" aria-hidden>·</span>}
            {p.text}
          </span>
        </InfoTip>
      ))}
    </p>
  );
}
