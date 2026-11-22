import { useEffect, useMemo, useRef, useState } from 'react';
import { AreaSeries, ColorType, LineStyle, createChart, type UTCTimestamp } from 'lightweight-charts';
import type { PaperApi } from '../hooks/usePaper.ts';
import { downloadBlob } from '../lib/chartImage.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { CURRENCY, DEFAULT_BUDGET, openOrders, summarize, type EquityPoint } from '../lib/paper.ts';
import { cssVar, useAppearanceKey } from '../lib/theme.ts';
import type { MarketId, Quote } from '../lib/types.ts';
import { PnlBreakdown, TradesSection } from './PortfolioTrades.tsx';
import { SortHeader, useSortedRows } from './SortHeader.tsx';
import { fillsOf, realizedByStock, unrealizedByStock } from '../lib/paperStats.ts';

interface Props {
  market: MarketId;
  paper: PaperApi;
  quotes: Record<string, Quote>;
  onOpen: (symbol: string) => void;
  onToast: (message: string) => void;
  /** Opens Ask AI and asks it to review this wallet. */
  onAnalyse: (market: MarketId) => void;
}

const ticker = (s: string) => s.replace(/\.(NS|BO)$/, '');

function EquityChart({ points, start, currency }: { points: EquityPoint[]; start: number; currency: string }) {
  const host = useRef<HTMLDivElement>(null);
  const appearance = useAppearanceKey();
  useEffect(() => {
    const el = host.current!;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--text-2'), fontFamily: cssVar('--font-sans'), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--grid') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale: false,
    });
    const last = points[points.length - 1]?.v ?? start;
    const color = last >= start ? cssVar('--up') : cssVar('--down');
    const series = chart.addSeries(AreaSeries, { lineColor: color, topColor: last >= start ? cssVar('--up-soft') : cssVar('--down-soft'), bottomColor: 'transparent', lineWidth: 2, priceFormat: { type: 'custom', formatter: (v: number) => formatPrice(v, currency, 2) } });
    // One point per second at most (the chart needs strictly increasing times).
    const bySecond = new Map<number, number>();
    for (const p of points) bySecond.set(Math.floor(p.t / 1000), p.v);
    series.setData([...bySecond.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })));
    series.createPriceLine({ price: start, color: cssVar('--text-3'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: 'Start' });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, start, currency, appearance]);
  return <div className="equity-chart" ref={host} />;
}

/** The paper-trading account for one market: totals, equity curve, holdings, orders, history. */
export function Portfolio({ market, paper, quotes, onOpen, onToast, onAnalyse }: Props) {
  const s = paper.state;
  const currency = CURRENCY[market];
  const money = (v: number | null | undefined, digits = 2) => formatPrice(v, currency, digits);
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${formatPrice(Math.abs(v), currency)}`;
  const sum = summarize(s, market, paper.prices);
  const positions = s.positions.filter((p) => p.market === market);
  const working = openOrders(s).filter((o) => o.market === market);
  const history = useMemo(() => s.orders.filter((o) => o.market === market && o.status !== 'open').sort((a, b) => (b.filledAt ?? 0) - (a.filledAt ?? 0)), [s.orders, market]);
  const [showAll, setShowAll] = useState(false);
  const fills = useMemo(() => fillsOf(s, market), [s, market]);
  const saleById = useMemo(() => new Map(fills.filter((f) => f.side === 'sell').map((f) => [f.id, f])), [fills]);
  const [breakdown, setBreakdown] = useState<'realized' | 'unrealized' | null>(null);
  const toggleBreakdown = (k: 'realized' | 'unrealized') => setBreakdown((b) => (b === k ? null : k));

  // Every table sorts on every column (click a heading; again to flip; a third time to reset).
  const holdingRows = positions.map((p) => {
    const last = paper.prices[p.symbol] ?? null;
    return { p, last, value: last != null ? last * p.qty : null, pnl: last != null ? (last - p.avgCost) * p.qty : null, q: quotes[p.symbol] };
  });
  const holdings = useSortedRows(holdingRows, (r, k: 'stock' | 'qty' | 'avg' | 'last' | 'value' | 'pnl' | 'today') =>
    k === 'stock' ? ticker(r.p.symbol) : k === 'qty' ? r.p.qty : k === 'avg' ? r.p.avgCost : k === 'last' ? r.last : k === 'value' ? r.value : k === 'pnl' ? r.pnl : (r.q?.changePct ?? null),
  );
  const workingSort = useSortedRows(working, (o, k: 'stock' | 'placed' | 'side' | 'order') =>
    k === 'stock' ? ticker(o.symbol) : k === 'placed' ? o.createdAt : k === 'side' ? o.side : (o.price ?? o.estPrice ?? null),
  );
  const historySort = useSortedRows(history, (o, k: 'when' | 'stock' | 'side' | 'qty' | 'price' | 'amount' | 'status') =>
    k === 'when'
      ? (o.filledAt ?? o.createdAt)
      : k === 'stock'
        ? ticker(o.symbol)
        : k === 'side'
          ? o.side
          : k === 'qty'
            ? o.qty
            : k === 'price'
              ? (o.fillPrice ?? null)
              : k === 'amount'
                ? (saleById.get(o.id)?.realized ?? (o.status === 'filled' && o.fillPrice != null ? -o.fillPrice * o.qty : null))
                : o.status,
  );

  const [budget, setBudget] = useState({ IN: String(s.wallets.IN.start), US: String(s.wallets.US.start) });
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingImport, setPendingImport] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const doReset = () => {
    const IN = Number(budget.IN);
    const US = Number(budget.US);
    if (!(IN > 0) || !(US > 0)) return onToast('Starting budgets must be above zero.');
    paper.reset({ IN, US });
    setConfirmReset(false);
    onToast('Paper account reset.');
  };

  const doExport = () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `stockmarketview-paper-${new Date().toISOString().slice(0, 10)}.json`);
    onToast('Account exported.');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPendingImport(JSON.parse(await file.text()));
    } catch {
      onToast("That file isn't valid JSON.");
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="portfolio">
      <header className="pulse-head">
        <div className="pulse-title">
          <h1>{market === 'IN' ? 'India portfolio (₹)' : 'US portfolio ($)'}</h1>
          <span className="badge subtle">Simulated</span>
        </div>
        {(positions.length > 0 || history.length > 0) && (
          <button className="ask-ai-btn analyse-btn" onClick={() => onAnalyse(market)} title="Ask AI to summarise what's doing well and what isn't. It describes; it doesn't recommend trades.">
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
            </svg>
            <span>Analyse with AI</span>
          </button>
        )}
      </header>

      <div className="pf-cards">
        <div className="pf-card main">
          <span className="pf-card-label">Account value</span>
          <b className="num">{money(sum.equity)}</b>
          <span className={`num ${sum.equity >= sum.start ? 'up' : 'down'}`}>
            {signed(sum.equity - sum.start)} ({formatPct(sum.totalReturnPct)}) since start
          </span>
        </div>
        <div className="pf-card">
          <span className="pf-card-label">Cash</span>
          <b className="num">{money(sum.cash)}</b>
        </div>
        <div className="pf-card">
          <span className="pf-card-label">Holdings</span>
          <b className="num">{money(sum.holdingsValue)}</b>
        </div>
        <button className={`pf-card clickable ${breakdown === 'unrealized' ? 'open' : ''}`} onClick={() => toggleBreakdown('unrealized')} aria-expanded={breakdown === 'unrealized'} title="Profit or loss on shares you still hold. Click to see it by holding.">
          <span className="pf-card-label">Unrealised P&amp;L</span>
          <b className={`num ${sum.unrealized >= 0 ? 'up' : 'down'}`}>{signed(sum.unrealized)}</b>
          <span className="pf-card-more">By holding ›</span>
        </button>
        <button className={`pf-card clickable ${breakdown === 'realized' ? 'open' : ''}`} onClick={() => toggleBreakdown('realized')} aria-expanded={breakdown === 'realized'} title="Profit or loss locked in by selling. Click to see it by stock.">
          <span className="pf-card-label">Realised P&amp;L</span>
          <b className={`num ${sum.realized >= 0 ? 'up' : 'down'}`}>{signed(sum.realized)}</b>
          <span className="pf-card-more">By stock ›</span>
        </button>
      </div>
      {breakdown && (
        <PnlBreakdown
          kind={breakdown}
          rows={breakdown === 'realized' ? realizedByStock(fills) : unrealizedByStock(positions, paper.prices)}
          currency={currency}
          quotes={quotes}
          onOpen={onOpen}
          onClose={() => setBreakdown(null)}
        />
      )}
      {sum.priceMissing && <p className="card-sub">Some holdings have no current price yet and are valued at cost.</p>}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Account value over time</h2>
            <p className="card-sub">Recorded while this site is open, at most every 10 minutes and after every trade. Dashed line: starting budget.</p>
          </div>
        </div>
        {s.equity[market].length > 1 ? <EquityChart points={s.equity[market]} start={sum.start} currency={currency} /> : <p className="empty-note">The curve starts after your first trade.</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Holdings</h2>
        </div>
        {positions.length === 0 ? (
          <p className="empty-note">No holdings. Open any {market === 'IN' ? 'NSE or BSE' : 'US'} stock and use the Trade panel beside the chart.</p>
        ) : (
          <div className="pt-table">
            <div className="pt-row pt-head">
              <SortHeader label="Stock" k="stock" sort={holdings} />
              <SortHeader label="Qty" k="qty" sort={holdings} numeric className="num-col" />
              <SortHeader label="Avg cost" k="avg" sort={holdings} numeric className="num-col" />
              <SortHeader label="Last" k="last" sort={holdings} numeric className="num-col" />
              <SortHeader label="Value" k="value" sort={holdings} numeric className="num-col" />
              <SortHeader label="P&L" k="pnl" sort={holdings} numeric className="num-col" />
              <SortHeader label="Today" k="today" sort={holdings} numeric className="num-col" />
            </div>
            {holdings.rows.map(({ p, last, pnl, q }) => {
              return (
                <button key={p.symbol} className="pt-row" onClick={() => onOpen(p.symbol)}>
                  <span className="pf-stock">
                    <b>{ticker(p.symbol)}</b>
                    <span>{q?.name ?? ''}</span>
                  </span>
                  <span className="num num-col">{p.qty}</span>
                  <span className="num num-col">{money(p.avgCost)}</span>
                  <span className="num num-col">{money(last)}</span>
                  <span className="num num-col">{money(last != null ? last * p.qty : null)}</span>
                  <span className={`num num-col ${pnl == null ? '' : pnl >= 0 ? 'up' : 'down'}`}>
                    {pnl == null ? '—' : `${signed(pnl)} (${formatPct(((last! - p.avgCost) / p.avgCost) * 100)})`}
                  </span>
                  <span className={`num num-col ${(q?.changePct ?? 0) >= 0 ? 'up' : 'down'}`}>{q ? formatPct(q.changePct) : '—'}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <TradesSection fills={fills} market={market} currency={currency} quotes={quotes} onOpen={onOpen} />

      {working.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Working orders</h2>
            <p className="card-sub">Checked against each new price while this site is open.</p>
          </div>
          <div className="pt-table">
            <div className="pt-row orders pt-head">
              <span className="sort-pair">
                <SortHeader label="Stock" k="stock" sort={workingSort} />
                <SortHeader label="Placed" k="placed" sort={workingSort} numeric />
              </span>
              <SortHeader label="Side" k="side" sort={workingSort} />
              <SortHeader label="Order price" k="order" sort={workingSort} numeric />
              <span />
            </div>
            {workingSort.rows.map((o) => (
              <div key={o.id} className="pt-row orders">
                <span className="pf-stock">
                  <b>{ticker(o.symbol)}</b>
                  <span>{new Date(o.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                </span>
                <span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? 'Buy' : 'Sell'}</span>
                <span>
                  {o.qty} · {o.type}
                  {o.price != null ? ` at ${money(o.price)}` : ' (fills after the open)'}
                </span>
                <button className="link" onClick={() => paper.cancel(o.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Order history</h2>
        </div>
        {history.length === 0 ? (
          <p className="empty-note">No filled or cancelled orders yet.</p>
        ) : (
          <div className="pt-table">
            <div className="pt-row history pt-head">
              <SortHeader label="When" k="when" sort={historySort} numeric />
              <SortHeader label="Stock" k="stock" sort={historySort} />
              <SortHeader label="Side" k="side" sort={historySort} />
              <SortHeader label="Qty" k="qty" sort={historySort} numeric />
              <SortHeader label="Price" k="price" sort={historySort} numeric className="num-col" />
              <SortHeader label="Cost / P&L" k="amount" sort={historySort} numeric className="num-col" />
              <SortHeader label="Status" k="status" sort={historySort} />
            </div>
            {(showAll ? historySort.rows : historySort.rows.slice(0, 15)).map((o) => (
              <div key={o.id} className="pt-row history">
                <span className="card-sub">{new Date(o.filledAt ?? o.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                <b>{ticker(o.symbol)}</b>
                <span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? 'Bought' : 'Sold'}</span>
                <span className="num">
                  {o.qty} {o.type}
                </span>
                <span className="num num-col">{o.fillPrice != null ? money(o.fillPrice) : '—'}</span>
                <span className={`num num-col ${(saleById.get(o.id)?.realized ?? 0) >= 0 ? 'up' : 'down'}`} title={saleById.has(o.id) ? 'Profit or loss on this sale against your average cost' : undefined}>
                  {saleById.has(o.id) ? signed(saleById.get(o.id)!.realized!) : o.status === 'filled' && o.fillPrice != null ? <span className="card-sub">{money(o.fillPrice * o.qty)}</span> : ''}
                </span>
                <span className={`hist-status ${o.status}`} title={o.note}>
                  {o.status === 'filled' ? 'Filled' : o.status === 'cancelled' ? 'Cancelled' : `Rejected: ${o.note ?? ''}`}
                </span>
              </div>
            ))}
          </div>
        )}
        {history.length > 15 && (
          <button className="link show-more" onClick={() => setShowAll((x) => !x)}>
            {showAll ? 'Show fewer' : `Show all ${history.length}`}
          </button>
        )}
      </section>

      <section className="card pf-settings">
        <div className="card-head">
          <div>
            <h2>Account</h2>
            <p className="card-sub">Stored only in this browser. Export it to keep a copy or move it to another device.</p>
          </div>
        </div>
        <div className="pf-budget">
          <label>
            India starting budget (₹)
            <input type="number" min={1} value={budget.IN} onChange={(e) => setBudget((b) => ({ ...b, IN: e.target.value }))} />
          </label>
          <label>
            US starting budget ($)
            <input type="number" min={1} value={budget.US} onChange={(e) => setBudget((b) => ({ ...b, US: e.target.value }))} />
          </label>
          {confirmReset ? (
            <span className="pf-confirm">
              Erase all holdings, orders and history and start over?
              <button className="btn danger-btn" onClick={doReset}>
                Yes, reset
              </button>
              <button className="btn" onClick={() => setConfirmReset(false)}>
                Keep my account
              </button>
            </span>
          ) : (
            <button className="btn" onClick={() => setConfirmReset(true)}>
              Reset account…
            </button>
          )}
        </div>
        <p className="card-sub">New budgets apply when you reset. Defaults: {formatPrice(DEFAULT_BUDGET.IN, 'INR', 0)} and {formatPrice(DEFAULT_BUDGET.US, 'USD', 0)}.</p>
        <div className="pf-io">
          <button className="btn" onClick={doExport}>
            Export (JSON)
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import…
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          {pendingImport != null && (
            <span className="pf-confirm">
              Replace this account with the imported file?
              <button
                className="btn danger-btn"
                onClick={() => {
                  onToast(paper.importState(pendingImport) ? 'Account imported.' : "That file isn't a StockMarketView paper account.");
                  setPendingImport(null);
                }}
              >
                Replace
              </button>
              <button className="btn" onClick={() => setPendingImport(null)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      </section>

      <p className="tp-disclaimer">
        Paper trading uses virtual money. Orders are only checked while this site is open in a tab; fills ignore slippage, fees, dividends and splits. Nothing here is investment advice.
      </p>
    </div>
  );
}
