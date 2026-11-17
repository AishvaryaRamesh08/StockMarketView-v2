import { useMemo, useRef, useState } from 'react';
import { useDailyHistory, useSeen } from '../hooks/useHistory.ts';
import { formatPct } from '../lib/format.ts';
import { OVERLAY_BY_ID, type OverlayId } from '../lib/overlays.ts';
import { trackRecord, verdict } from '../lib/patternStats.ts';
import { InfoTip } from './InfoTip.tsx';

const HORIZONS = [5, 10, 20];
const VERDICT: Record<ReturnType<typeof verdict>, string> = { better: 'Better than usual', similar: 'About usual', worse: 'Worse than usual', 'too few': 'Too few to judge' };

/** How each candlestick pattern played out on this stock over the last 10 years of daily candles. */
export function PatternTrackRecord({ symbol, active, onShow }: { symbol: string; active: ReadonlySet<OverlayId>; onShow: (id: OverlayId) => void }) {
  const box = useRef<HTMLElement>(null);
  const seen = useSeen(box);
  const { candles, error } = useDailyHistory(symbol, seen);
  const [horizon, setHorizon] = useState(5);
  const tr = useMemo(() => (candles && candles.length > 40 ? trackRecord(candles, horizon) : null), [candles, horizon]);
  const ticker = symbol.replace(/\.(NS|BO)$/, '').replace(/^\^/, '');
  const rows = tr ? [...tr.records].sort((a, b) => b.count - a.count) : [];

  return (
    <section className="card track-record" ref={box} aria-labelledby="tr-title">
      <div className="card-head">
        <div>
          <h2 id="tr-title">How have candlestick patterns worked on {ticker}?</h2>
          <p className="card-sub">
            Every time a pattern formed in {tr ? `the last ${Math.max(1, Math.round(tr.years))} years` : 'up to 10 years'} of daily candles, and what the price did over the next {horizon} trading days. Past behaviour, not a prediction.
          </p>
        </div>
        <div className="segmented text" role="radiogroup" aria-label="Days after the pattern">
          {HORIZONS.map((h) => (
            <button key={h} role="radio" aria-checked={horizon === h} className={horizon === h ? 'active' : ''} onClick={() => setHorizon(h)}>
              {h} days
            </button>
          ))}
        </div>
      </div>

      {error && <p className="empty-note">History didn't load: {error}</p>}
      {!tr && !error && <div className="skeleton" style={{ height: 180 }} />}
      {tr && (
        <>
          <p className="tr-base">
            For comparison: on any day, {ticker} was higher {horizon} days later <b className="num">{Math.round(tr.baseUpPct ?? 0)}%</b> of the time (average move <b className="num">{formatPct(tr.baseAvgPct)}</b>). A pattern only tells you something if it beats that.
          </p>
          <div className="pt-table" role="table" aria-label="Pattern track record">
            <div className="pt-row tr-row pt-head" role="row">
              <span>Pattern</span>
              <span className="num-col">Times</span>
              <span>
                <InfoTip text="Bullish patterns: share of times the price was higher afterwards. Bearish: share of times it was lower. Doji: share of times it was higher.">
                  <span className="help" tabIndex={0}>
                    Went the expected way
                  </span>
                </InfoTip>
              </span>
              <span className="num-col">Avg move</span>
              <span className="num-col">Best / worst</span>
              <span>Compared with usual</span>
            </div>
            {rows.map((r) => {
              const def = OVERLAY_BY_ID.get(r.pattern)!;
              const v = verdict(r, tr);
              const base = r.bias === 'bearish' ? 100 - (tr.baseUpPct ?? 50) : (tr.baseUpPct ?? 50);
              const on = active.has(r.pattern);
              return (
                <div key={r.pattern} className="pt-row tr-row" role="row">
                  <span className="tr-name">
                    <span className="swatch" style={{ background: def.color }} />
                    <span>
                      <b>{def.label}</b>
                      <span className="card-sub">
                        {r.bias === 'bullish' ? 'expects a rise' : r.bias === 'bearish' ? 'expects a fall' : 'indecision'}
                        {r.lastSeen ? ` · last ${new Date(r.lastSeen * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className="num num-col">{r.count}</span>
                  <span className="tr-rate">
                    {r.workedPct == null ? (
                      <span className="card-sub">—</span>
                    ) : (
                      <>
                        <span className="tr-bar" aria-hidden>
                          <span className={`tr-fill ${r.workedPct >= base ? 'up' : 'down'}`} style={{ width: `${r.workedPct}%` }} />
                          <span className="tr-base-mark" style={{ left: `${base}%` }} title={`Usual: ${Math.round(base)}%`} />
                        </span>
                        <span className="num">{Math.round(r.workedPct)}%</span>
                      </>
                    )}
                  </span>
                  <span className={`num num-col ${(r.avgReturnPct ?? 0) >= 0 ? 'up' : 'down'}`}>{r.avgReturnPct == null ? '—' : formatPct(r.avgReturnPct)}</span>
                  <span className="num num-col tr-range">{r.bestReturnPct == null ? '—' : `${formatPct(r.bestReturnPct)} / ${formatPct(r.worstReturnPct)}`}</span>
                  <span className="tr-verdict">
                    <span className={`tr-chip ${v.replace(' ', '-')}`}>{VERDICT[v]}</span>
                    <button className="link" onClick={() => onShow(r.pattern)} disabled={on}>
                      {on ? 'On chart' : 'Show on chart'}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="card-sub tr-foot">Measured from the close of the candle that completes the pattern to the close {horizon} trading days later. Fees, gaps and slippage are ignored.</p>
        </>
      )}
    </section>
  );
}
