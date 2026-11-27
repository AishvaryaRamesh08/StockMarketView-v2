import type { SummaryPart } from '../lib/summary.ts';
import type { Profile, Quote } from '../lib/types.ts';
import { InfoTip } from './InfoTip.tsx';
import { QuoteStats } from './QuoteHeader.tsx';

/**
 * The Details column on the right of the chart: the numbers, the company and the plain-English
 * summary that would otherwise crowd the space above the chart.
 */
export function StockDetails({ quote, profile, glance }: { quote: Quote | null; profile: Profile | null; glance: SummaryPart[] }) {
  if (!quote) return <div className="details-panel"><p className="empty-note">Loading…</p></div>;
  return (
    <div className="details-panel">
      <section>
        <h3>Key numbers</h3>
        <QuoteStats quote={quote} profile={profile} vertical />
      </section>
      {(profile?.sector || quote.exchange) && (
        <section>
          <h3>Company</h3>
          <dl className="quote-stats vertical">
            {profile?.sector && (
              <div>
                <dt>Sector</dt>
                <dd>{profile.sector}</dd>
              </div>
            )}
            {profile?.industry && (
              <div>
                <dt>Industry</dt>
                <dd>{profile.industry}</dd>
              </div>
            )}
            {quote.exchange && (
              <div>
                <dt>Exchange</dt>
                <dd>
                  {quote.exchange} · {quote.currency}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}
      {glance.length > 0 && (
        <section>
          <h3>At a glance</h3>
          <ul className="details-glance" aria-label="Chart summary">
            {glance.map((p) => (
              <li key={p.text}>
                <span className={`glance-dot tone-${p.tone}`} aria-hidden />
                <InfoTip text={p.hint}>
                  <span className={`summary-part tone-${p.tone} help`} tabIndex={0}>
                    {p.text}
                  </span>
                </InfoTip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
