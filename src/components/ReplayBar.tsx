import { useState } from 'react';
import { REPLAY_SPEEDS, type ReplayApi } from '../hooks/useReplay.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { equityOf } from '../lib/replay.ts';
import { InfoTip } from './InfoTip.tsx';

const ymd = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Controls for replay mode: step, play, pick a start date, and a practice account that trades at the current candle's close. */
export function ReplayBar({ r, name, intervalLabel, intraday, currency, onExit }: { r: ReplayApi; name: string; intervalLabel: string; intraday: boolean; currency: string; onExit: () => void }) {
  const [qty, setQty] = useState('10');
  const [msg, setMsg] = useState<string | null>(null);
  const money = (v: number) => formatPrice(v, currency, 2);
  const c = r.current;
  const a = r.account;
  const equity = c ? equityOf(a, c.c) : a.start;
  const ret = ((equity - a.start) / a.start) * 100;
  const hold = c && r.startPrice ? ((c.c - r.startPrice) / r.startPrice) * 100 : 0;
  const when = c ? new Date(c.t * 1000).toLocaleString(undefined, intraday ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const trade = (side: 'buy' | 'sell') => {
    const n = Number(qty);
    const err = side === 'buy' ? r.buy(n) : r.sell(n);
    setMsg(err);
  };

  return (
    <section className="replay-bar" aria-label="Replay">
      <div className="rp-top">
        <span className="rp-badge">
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M4 10a6 6 0 1 0 2-4.5M4 3v3h3" />
          </svg>
          Replay
        </span>
        <span className="rp-title">
          <b>{name}</b> · {intervalLabel}
        </span>
        <span className="rp-when">
          {r.status === 'ready' && c ? (
            <>
              <b>{when}</b> <span className="num">close {money(c.c)}</span>
            </>
          ) : r.status === 'error' ? (
            <span className="down">History didn't load: {r.error}</span>
          ) : (
            'Loading history…'
          )}
        </span>
        <button className="btn rp-exit" onClick={onExit}>
          Exit replay
        </button>
      </div>

      {r.status === 'ready' && (
        <>
          <div className="rp-controls">
            <div className="rp-buttons" role="group" aria-label="Playback">
              <button className="icon-btn" onClick={() => r.step(-1)} disabled={!r.canStepBack} title="Back one candle (←)" aria-label="Back one candle">
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="M12.5 5l-5 5 5 5" />
                </svg>
              </button>
              <button className="icon-btn rp-play" onClick={r.togglePlay} disabled={r.atEnd} title={r.playing ? 'Pause (space)' : 'Play (space)'} aria-label={r.playing ? 'Pause' : 'Play'}>
                <svg viewBox="0 0 20 20" aria-hidden>{r.playing ? <path d="M7 5v10M13 5v10" /> : <path d="M7 5l8 5-8 5z" />}</svg>
              </button>
              <button className="icon-btn" onClick={() => r.step(1)} disabled={r.atEnd} title="Next candle (→)" aria-label="Next candle">
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="M7.5 5l5 5-5 5" />
                </svg>
              </button>
            </div>
            <div className="segmented text" role="radiogroup" aria-label="Speed">
              {REPLAY_SPEEDS.map((s) => (
                <button key={s} role="radio" aria-checked={r.speed === s} className={r.speed === s ? 'active' : ''} onClick={() => r.setSpeed(s)} title={`${s} candle${s === 1 ? '' : 's'} a second`}>
                  {s}×
                </button>
              ))}
            </div>
            <label className="rp-date">
              <span>Start from</span>
              <input
                type="date"
                min={r.firstDate ? ymd(r.firstDate) : undefined}
                max={r.lastDate ? ymd(r.lastDate) : undefined}
                onChange={(e) => e.target.value && r.jumpTo(Date.parse(`${e.target.value}T00:00:00Z`) / 1000)}
                aria-label="Start replay from date"
              />
            </label>
            <span className="card-sub rp-hint">Starting a new date resets the practice account.</span>
          </div>

          <div className="rp-account">
            <div>
              <span className="pf-card-label">Practice cash</span>
              <b className="num">{money(a.cash)}</b>
            </div>
            <div>
              <span className="pf-card-label">Holding</span>
              <b className="num">{a.qty ? `${a.qty} @ ${money(a.avg)}` : '—'}</b>
            </div>
            <div>
              <InfoTip text="Your practice account's change since this replay started: cash plus shares at the current close.">
                <span className="pf-card-label help" tabIndex={0}>
                  Your result
                </span>
              </InfoTip>
              <b className={`num ${ret >= 0 ? 'up' : 'down'}`}>
                {formatPct(ret)} <span className="bd-pct">({money(equity - a.start)})</span>
              </b>
            </div>
            <div>
              <InfoTip text="What simply buying at the replay's first candle and holding would have returned by now.">
                <span className="pf-card-label help" tabIndex={0}>
                  Buy and hold
                </span>
              </InfoTip>
              <b className={`num ${hold >= 0 ? 'up' : 'down'}`}>{formatPct(hold)}</b>
            </div>
            <div className="rp-ticket">
              <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Shares" />
              {!r.canTrade && (
                <button className="link" onClick={r.toLatest}>
                  Back to latest candle to trade
                </button>
              )}
              <button className="btn tp-submit buy" onClick={() => trade('buy')} disabled={!r.canTrade}>
                Buy
              </button>
              <button className="btn tp-submit sell" onClick={() => trade('sell')} disabled={!a.qty || !r.canTrade}>
                Sell
              </button>
            </div>
          </div>
          {msg && <p className="tp-error">{msg}</p>}
          {r.atEnd && (
            <p className="rp-end">
              You've reached the latest candle. Your practice result: <b className={ret >= 0 ? 'up' : 'down'}>{formatPct(ret)}</b> against <b className={hold >= 0 ? 'up' : 'down'}>{formatPct(hold)}</b> for buy and hold, with {a.trades.length} trade{a.trades.length === 1 ? '' : 's'}. Pick another start date to try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
