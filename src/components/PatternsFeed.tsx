import { useMemo, useState } from 'react';
import { formatPct, formatPrice } from '../lib/format.ts';
import type { PatternFeed } from '../lib/marketData.ts';
import { OVERLAY_BY_ID, PATTERN_IDS } from '../lib/overlays.ts';
import type { PatternId } from '../lib/patterns.ts';
import { InfoTip } from './InfoTip.tsx';

interface Props {
  feed: PatternFeed | null;
  error: string | null;
  currency: string;
  onOpen: (symbol: string, pattern: PatternId) => void;
}

type BiasFilter = 'all' | 'bullish' | 'bearish';

function sessionLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "Patterns today": stocks whose latest daily candle formed a pattern, from the scheduled scan. */
export function PatternsFeed({ feed, error, currency, onOpen }: Props) {
  const [bias, setBias] = useState<BiasFilter>('all');
  const [pattern, setPattern] = useState<PatternId | 'any'>('any');
  const [showAll, setShowAll] = useState(false);

  const hits = useMemo(() => (feed?.hits ?? []).filter((h) => (bias === 'all' || h.b === bias) && (pattern === 'any' || h.p === pattern)), [feed, bias, pattern]);
  const counts = useMemo(() => {
    const c = { bullish: 0, bearish: 0 };
    for (const h of feed?.hits ?? []) if (h.b !== 'neutral') c[h.b]++;
    return c;
  }, [feed]);
  const shown = showAll ? hits : hits.slice(0, 12);

  return (
    <section className="card patterns-feed" aria-labelledby="pf-title">
      <div className="card-head">
        <div>
          <h2 id="pf-title">Patterns today</h2>
          <p className="card-sub">
            {feed
              ? `Candlestick patterns on the ${sessionLabel(feed.session)} close · ${feed.scanned} stocks scanned · ${counts.bullish} bullish, ${counts.bearish} bearish`
              : error
                ? "The scan hasn't been published yet; it runs after each market close."
                : 'Loading the latest scan…'}
          </p>
        </div>
        <div className="pf-filters">
          <div className="segmented text" role="radiogroup" aria-label="Direction">
            {(['all', 'bullish', 'bearish'] as const).map((b) => (
              <button key={b} role="radio" aria-checked={bias === b} className={bias === b ? 'active' : ''} onClick={() => setBias(b)}>
                {b === 'all' ? 'All' : b === 'bullish' ? '▲ Bullish' : '▼ Bearish'}
              </button>
            ))}
          </div>
          <select value={pattern} onChange={(e) => setPattern(e.target.value as PatternId | 'any')} aria-label="Pattern type">
            <option value="any">Any pattern</option>
            {PATTERN_IDS.filter((p) => p !== 'doji').map((p) => (
              <option key={p} value={p}>
                {OVERLAY_BY_ID.get(p)!.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {feed && hits.length === 0 && <p className="empty-note">No stocks matched this filter on the latest session.</p>}
      {feed && hits.length > 0 && (
        <div className="pf-table" role="group" aria-label="Pattern hits">
          <div className="pf-row pf-headrow">
            <span>Stock</span>
            <span>Pattern</span>
            <span className="num-col">
              Close
            </span>
            <span className="num-col">
              Day
            </span>
            <span className="num-col">
              <InfoTip text="Volume on the pattern candle compared with the 20-day average. Patterns on unusually high volume are generally taken more seriously.">
                <span tabIndex={0} className="help">
                  Volume
                </span>
              </InfoTip>
            </span>
            <span className="num-col">
              RSI
            </span>
          </div>
          {shown.map((h) => {
            const def = OVERLAY_BY_ID.get(h.p)!;
            return (
              <button key={`${h.s}-${h.p}`} className="pf-row" onClick={() => onOpen(h.s, h.p)}>
                <span className="pf-stock">
                  <b>{h.s.replace(/\.(NS|BO)$/, '')}</b>
                  <span>{h.n}</span>
                </span>
                <span>
                  <InfoTip text={def.info}>
                    <span className={`pattern-badge ${h.b}`}>
                      {h.b === 'bullish' ? '▲' : '▼'} {def.label}
                    </span>
                  </InfoTip>
                </span>
                <span className="num num-col">
                  {formatPrice(h.c, currency, 2, false)}
                </span>
                <span className={`num num-col ${h.chg >= 0 ? 'up' : 'down'}`}>
                  {formatPct(h.chg)}
                </span>
                <span className={`num num-col ${h.vr != null && h.vr >= 1.5 ? 'strong' : ''}`}>
                  {h.vr != null ? `${h.vr.toFixed(1)}×` : '—'}
                </span>
                <span className="num num-col">
                  {h.rsi ?? '—'}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {hits.length > 12 && (
        <button className="link show-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show fewer' : `Show all ${hits.length}`}
        </button>
      )}
    </section>
  );
}
