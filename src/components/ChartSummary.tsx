import type { SummaryPart } from '../lib/summary.ts';
import { InfoTip } from './InfoTip.tsx';

/** Small "At a glance" button with one dot per signal, coloured by tone; expands the summary row. */
export function GlanceToggle({ parts, open, onToggle }: { parts: SummaryPart[]; open: boolean; onToggle: () => void }) {
  if (!parts.length) return null;
  return (
    <button className={`glance-toggle ${open ? 'open' : ''}`} onClick={onToggle} aria-expanded={open} aria-controls="chart-summary" title={open ? 'Hide the quick summary' : 'Show a quick plain-English summary of the chart'}>
      At a glance
      <span className="glance-dots" aria-hidden>
        {parts.map((p) => (
          <span key={p.text} className={`glance-dot tone-${p.tone}`} />
        ))}
      </span>
      <svg viewBox="0 0 12 12" aria-hidden>
        <path d="M3 4.5l3 3 3-3" />
      </svg>
    </button>
  );
}

/** "Above 50-day average · RSI 68 · Bearish engulfing 2 days ago", with hover explanations. */
export function ChartSummary({ parts }: { parts: SummaryPart[] }) {
  if (!parts.length) return null;
  return (
    <p className="chart-summary" id="chart-summary" aria-label="Chart summary">
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
