import { useMemo, useState } from 'react';
import { formatPct, formatPrice } from '../lib/format.ts';
import { inPeriod, pnlByDay, pnlByStock, tradeStats, type Contribution, type Fill, type Period } from '../lib/paperStats.ts';
import type { MarketId, Quote } from '../lib/types.ts';
import { InfoTip } from './InfoTip.tsx';

const ticker = (s: string) => s.replace(/\.(NS|BO)$/, '');
const PERIODS: Array<[Period, string]> = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['all', 'All time'],
];

function useMoney(currency: string) {
  const money = (v: number | null | undefined) => formatPrice(v, currency, 2);
  const signed = (v: number) => `${v >= 0.005 ? '+' : v <= -0.005 ? '−' : ''}${formatPrice(Math.abs(v), currency)}`;
  const tone = (v: number) => (v >= 0.005 ? 'up' : v <= -0.005 ? 'down' : '');
  return { money, signed, tone };
}

/** "Which stocks made or lost money": opened from the Realised / Unrealised P&L cards. */
export function PnlBreakdown({ kind, rows, currency, quotes, onOpen, onClose }: { kind: 'realized' | 'unrealized'; rows: Contribution[]; currency: string; quotes: Record<string, Quote>; onOpen: (s: string) => void; onClose: () => void }) {
  const { signed, tone } = useMoney(currency);
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1e-9);
  const gains = rows.filter((r) => r.pnl > 0.005).reduce((a, r) => a + r.pnl, 0);
  const losses = rows.filter((r) => r.pnl < -0.005).reduce((a, r) => a + r.pnl, 0);
  return (
    <section className="card pnl-breakdown" aria-labelledby="pnl-bd-title">
      <div className="card-head">
        <div>
          <h2 id="pnl-bd-title">{kind === 'realized' ? 'Realised P&L by stock' : 'Unrealised P&L by holding'}</h2>
          <p className="card-sub">
            {kind === 'realized' ? 'Profit or loss locked in by selling, per stock, across all sales.' : 'Profit or loss on shares you still hold, at the latest price.'}
            {rows.length > 0 && (
              <>
                {' '}
                Gains <b className="up num">{signed(gains)}</b>, losses <b className="down num">{signed(losses)}</b>.
              </>
            )}
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close breakdown" title="Close">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="empty-note">{kind === 'realized' ? 'Nothing sold yet. Realised P&L appears once you sell shares.' : 'No holdings.'}</p>
      ) : (
        <div className="bd-list">
          {rows.map((r) => (
            <button key={r.symbol} className="bd-row" onClick={() => onOpen(r.symbol)}>
              <span className="pf-stock">
                <b>{ticker(r.symbol)}</b>
                <span>
                  {quotes[r.symbol]?.name ?? ''}
                  {r.qty != null ? ` · ${r.qty} held` : ''}
                </span>
              </span>
              <span className="bd-bar" aria-hidden>
                <span className={`bd-fill ${tone(r.pnl)}`} style={{ width: `${(Math.abs(r.pnl) / max) * 100}%` }} />
              </span>
              <span className={`num bd-val ${tone(r.pnl)}`}>
                {r.priced === false ? 'no price yet' : signed(r.pnl)}
                {r.pct != null && r.priced !== false && <span className="bd-pct"> {formatPct(r.pct)}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Per-stock and per-day P&L of the trades in a period: what you put in, what you got back, what you made. */
export function TradesSection({ fills, market, currency, quotes, onOpen }: { fills: Fill[]; market: MarketId; currency: string; quotes: Record<string, Quote>; onOpen: (s: string) => void }) {
  const [period, setPeriod] = useState<Period>('today');
  const [view, setView] = useState<'stock' | 'day'>('stock');
  const { money, signed, tone } = useMoney(currency);
  const inRange = useMemo(() => inPeriod(fills, period, market), [fills, period, market]);
  const stats = useMemo(() => tradeStats(inRange), [inRange]);
  const byStock = useMemo(() => pnlByStock(inRange), [inRange]);
  const byDay = useMemo(() => pnlByDay(inRange, market), [inRange, market]);
  const label = PERIODS.find((p) => p[0] === period)![1].toLowerCase();

  return (
    <section className="card trades" aria-labelledby="trades-title">
      <div className="card-head">
        <div>
          <h2 id="trades-title">Trades &amp; P&amp;L</h2>
          <p className="card-sub">What you invested, what you got back and what you made, {period === 'all' ? 'since you started' : period === 'today' ? `on the ${market === 'IN' ? 'Indian' : 'US'} market's current day` : `over the last ${label}`}.</p>
        </div>
        <div className="trades-controls">
          <div className="segmented text" role="radiogroup" aria-label="Period">
            {PERIODS.map(([id, l]) => (
              <button key={id} role="radio" aria-checked={period === id} className={period === id ? 'active' : ''} onClick={() => setPeriod(id)}>
                {l}
              </button>
            ))}
          </div>
          <div className="segmented text" role="radiogroup" aria-label="Group by">
            <button role="radio" aria-checked={view === 'stock'} className={view === 'stock' ? 'active' : ''} onClick={() => setView('stock')}>
              By stock
            </button>
            <button role="radio" aria-checked={view === 'day'} className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
              By day
            </button>
          </div>
        </div>
      </div>

      {inRange.length === 0 ? (
        <p className="empty-note">No trades {period === 'all' ? 'yet' : period === 'today' ? 'today' : `in the last ${label}`}.</p>
      ) : (
        <>
          <div className="trade-stats">
            <div>
              <InfoTip text="Money spent on buys in this period.">
                <span className="pf-card-label help" tabIndex={0}>
                  Invested
                </span>
              </InfoTip>
              <b className="num">{money(stats.invested)}</b>
            </div>
            <div>
              <InfoTip text="Money received from sales in this period.">
                <span className="pf-card-label help" tabIndex={0}>
                  Sold for
                </span>
              </InfoTip>
              <b className="num">{money(stats.proceeds)}</b>
            </div>
            <div>
              <InfoTip text="Profit or loss on the shares sold in this period, against what they cost you on average (including shares bought earlier).">
                <span className="pf-card-label help" tabIndex={0}>
                  Realised P&amp;L
                </span>
              </InfoTip>
              <b className={`num ${tone(stats.realized)}`}>{signed(stats.realized)}</b>
            </div>
            <div>
              <InfoTip text="Share of your sales that made money.">
                <span className="pf-card-label help" tabIndex={0}>
                  Win rate
                </span>
              </InfoTip>
              <b className="num">{stats.winRate == null ? '—' : `${Math.round(stats.winRate)}%`}</b>
              {stats.sales > 0 && (
                <span className="card-sub">
                  {stats.wins} of {stats.sales} sale{stats.sales === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div>
              <span className="pf-card-label">Best / worst sale</span>
              <span className="best-worst">
                {stats.best ? (
                  <span className="up num">
                    {ticker(stats.best.symbol)} {signed(stats.best.realized!)}
                  </span>
                ) : (
                  <span className="card-sub">—</span>
                )}
                {stats.worst && (
                  <span className="down num">
                    {ticker(stats.worst.symbol)} {signed(stats.worst.realized!)}
                  </span>
                )}
              </span>
            </div>
          </div>

          {view === 'stock' ? (
            <div className="pt-table" role="group" aria-label="P&L by stock">
              <div className="pt-row trades-row pt-head">
                <span>Stock</span>
                <span className="num-col">Bought</span>
                <span className="num-col">Invested</span>
                <span className="num-col">Sold</span>
                <span className="num-col">Received</span>
                <span className="num-col">Realised P&amp;L</span>
              </div>
              {byStock.map((r) => (
                <button key={r.symbol} className="pt-row trades-row" onClick={() => onOpen(r.symbol)}>
                  <span className="pf-stock">
                    <b>{ticker(r.symbol)}</b>
                    <span>
                      {quotes[r.symbol]?.name ?? ''}
                      {` · ${r.trades} trade${r.trades === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span className="num num-col">{r.boughtQty || '—'}</span>
                  <span className="num num-col">{r.invested ? money(r.invested) : '—'}</span>
                  <span className="num num-col">{r.soldQty || '—'}</span>
                  <span className="num num-col">{r.proceeds ? money(r.proceeds) : '—'}</span>
                  <span className={`num num-col ${tone(r.realized)}`}>
                    {r.soldQty ? (
                      <>
                        {signed(r.realized)}
                        {r.realizedPct != null && <span className="bd-pct"> {formatPct(r.realizedPct)}</span>}
                      </>
                    ) : (
                      <span className="card-sub">not sold</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="pt-table" role="group" aria-label="P&L by day">
              <div className="pt-row days-row pt-head">
                <span>Day</span>
                <span>Stocks</span>
                <span className="num-col">Invested</span>
                <span className="num-col">Received</span>
                <span className="num-col">Realised P&amp;L</span>
              </div>
              {byDay.map((d) => (
                <div key={d.day} className="pt-row days-row">
                  <span>
                    <b>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</b>
                    <span className="card-sub">
                      {' '}
                      · {d.trades} trade{d.trades === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="day-syms">{d.symbols.map(ticker).join(', ')}</span>
                  <span className="num num-col">{d.invested ? money(d.invested) : '—'}</span>
                  <span className="num num-col">{d.proceeds ? money(d.proceeds) : '—'}</span>
                  <span className={`num num-col ${tone(d.realized)}`}>{d.proceeds ? signed(d.realized) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
