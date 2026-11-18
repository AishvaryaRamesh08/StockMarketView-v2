import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, LineSeries, LineStyle, createChart, type UTCTimestamp } from 'lightweight-charts';
import { useDailyHistory, useSeen } from '../hooks/useHistory.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { marketOf } from '../lib/markets.ts';
import { cssVar, useAppearanceKey } from '../lib/theme.ts';
import type { MarketId } from '../lib/types.ts';
import { availableYears, fixedDeposit, planDates, samePlan, type Outcome } from '../lib/whatIf.ts';

const INDEX: Record<MarketId, { symbol: string; name: string }> = { IN: { symbol: '^NSEI', name: 'NIFTY 50' }, US: { symbol: '^GSPC', name: 'S&P 500' } };
const DEFAULTS: Record<MarketId, { lump: number; sip: number; fd: number }> = { IN: { lump: 100_000, sip: 5_000, fd: 7 }, US: { lump: 10_000, sip: 500, fd: 4.5 } };
/** Start points: years back, or 'max' for the earliest price loaded (up to 10 years, or since listing). */
const STARTS: Array<number | 'max'> = [1, 3, 5, 'max'];
const YEAR_S = 365.25 * 86400;

function ValueChart({ stock, index, label, indexLabel, currency }: { stock: Outcome; index: Outcome | null; label: string; indexLabel: string; currency: string }) {
  const host = useRef<HTMLDivElement>(null);
  const appearance = useAppearanceKey();
  useEffect(() => {
    const chart = createChart(host.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--text-2'), fontFamily: cssVar('--font-sans'), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--grid') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    const fmt = { type: 'custom' as const, formatter: (v: number) => formatPrice(v, currency, 0) };
    const line = (color: string, title: string, style: LineStyle = LineStyle.Solid, width: 1 | 2 = 2) => chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, title, priceFormat: fmt, lastValueVisible: true, priceLineVisible: false });
    const uniq = (pts: Array<{ t: number; v: number }>) => {
      const m = new Map<number, number>();
      for (const p of pts) m.set(p.t, p.v);
      return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
    };
    line(cssVar('--text-3'), 'Invested', LineStyle.Dashed, 1).setData(uniq(stock.series.map((p) => ({ t: p.t, v: p.invested }))));
    if (index) line(cssVar('--text-2'), indexLabel, LineStyle.Solid, 1).setData(uniq(index.series.map((p) => ({ t: p.t, v: p.value }))));
    line(cssVar('--accent'), label).setData(uniq(stock.series.map((p) => ({ t: p.t, v: p.value }))));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [stock, index, label, indexLabel, currency, appearance]);
  return <div className="whatif-chart" ref={host} />;
}

/** "What if I had invested…": a lump sum or a monthly SIP in this stock, against the index and a fixed deposit. */
export function WhatIf({ symbol, currency }: { symbol: string; currency: string }) {
  const market = marketOf(symbol);
  const box = useRef<HTMLElement>(null);
  const seen = useSeen(box);
  const isIndex = symbol === INDEX[market].symbol;
  const stock = useDailyHistory(symbol, seen);
  const index = useDailyHistory(isIndex ? null : INDEX[market].symbol, seen);
  const [kind, setKind] = useState<'lump' | 'sip'>('sip');
  const [amount, setAmount] = useState<Record<'lump' | 'sip', string>>({ lump: String(DEFAULTS[market].lump), sip: String(DEFAULTS[market].sip) });
  const [years, setYears] = useState<number | 'max'>(5);
  const [fdRate, setFdRate] = useState(String(DEFAULTS[market].fd));
  const ticker = symbol.replace(/\.(NS|BO)$/, '').replace(/^\^/, '');
  const money = (v: number) => formatPrice(v, currency, 0);
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${formatPrice(Math.abs(v), currency, 0)}`;

  const candles = stock.candles;
  const first = candles?.[0]?.t ?? 0;
  const lastT = candles?.[candles.length - 1]?.t ?? 0;
  const maxYears = candles ? availableYears(first, lastT) : 0;
  // 'max' starts on the first candle; a span longer than the history also falls back to it.
  const start = years === 'max' ? first : lastT - Math.min(years, Math.max(1, maxYears)) * YEAR_S;
  const amt = Number(amount[kind]);
  const rate = Number(fdRate);

  const result = useMemo(() => {
    if (!candles || candles.length < 30 || !(amt > 0)) return null;
    const s = samePlan(kind, candles, start, amt);
    if (!s) return null;
    const i = index.candles ? samePlan(kind, index.candles, start, amt) : null;
    const fd = Number.isFinite(rate) && rate >= 0 ? fixedDeposit(planDates(kind, candles, start), amt, s.endT, rate) : null;
    return { s, i, fd };
  }, [candles, index.candles, kind, start, amt, rate]);

  const rows = result
    ? [
        { name: ticker, invested: result.s.invested, value: result.s.value, annual: result.s.annualPct, main: true },
        ...(result.i ? [{ name: INDEX[market].name, invested: result.i.invested, value: result.i.value, annual: result.i.annualPct, main: false }] : []),
        ...(result.fd ? [{ name: `Fixed deposit at ${rate}%`, invested: result.fd.invested, value: result.fd.value, annual: (Math.pow(1 + rate / 400, 4) - 1) * 100 as number | null, main: false }] : []),
      ]
    : [];

  return (
    <section className="card whatif" ref={box} aria-labelledby="wi-title">
      <div className="card-head">
        <div>
          <h2 id="wi-title">What if you had invested in {ticker}?</h2>
          <p className="card-sub">On real past closing prices, compared with {isIndex ? 'a fixed deposit' : `the ${INDEX[market].name} and a fixed deposit`}.</p>
        </div>
        <div className="segmented text" role="radiogroup" aria-label="Plan">
          <button role="radio" aria-checked={kind === 'sip'} className={kind === 'sip' ? 'active' : ''} onClick={() => setKind('sip')}>
            Monthly SIP
          </button>
          <button role="radio" aria-checked={kind === 'lump'} className={kind === 'lump' ? 'active' : ''} onClick={() => setKind('lump')}>
            One-time
          </button>
        </div>
      </div>

      <div className="whatif-inputs">
        <label className="tp-field">
          <span className="tp-label">{kind === 'sip' ? 'Every month' : 'Amount'} ({currency === 'INR' ? '₹' : '$'})</span>
          <input type="number" inputMode="decimal" min={1} value={amount[kind]} onChange={(e) => setAmount((a) => ({ ...a, [kind]: e.target.value }))} aria-label="Amount" />
        </label>
        <div className="tp-field">
          <span className="tp-label">Starting</span>
          <div className="segmented text" role="radiogroup" aria-label="Start">
            {STARTS.map((y) => (
              <button
                key={y}
                role="radio"
                aria-checked={years === y}
                className={years === y ? 'active' : ''}
                onClick={() => setYears(y)}
                disabled={!!candles && y !== 'max' && y > Math.max(1, maxYears)}
                title={y === 'max' ? 'From the earliest price available: up to 10 years back, or since the stock listed' : undefined}
              >
                {y === 'max' ? 'Max' : `${y}Y ago`}
              </button>
            ))}
          </div>
        </div>
        <label className="tp-field fd-rate">
          <span className="tp-label">FD rate (% a year)</span>
          <input type="number" inputMode="decimal" min={0} max={20} step={0.1} value={fdRate} onChange={(e) => setFdRate(e.target.value)} aria-label="Fixed deposit rate" />
        </label>
      </div>

      {stock.error && <p className="empty-note">History didn't load: {stock.error}</p>}
      {!result && !stock.error && <div className="skeleton" style={{ height: 200 }} />}
      {result && (
        <>
          <p className="whatif-headline">
            {kind === 'sip' ? (
              <>
                {money(amt)} every month in {ticker} from {new Date(result.s.startT * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} ({result.s.installments} installments, {money(result.s.invested)} in total) would be worth{' '}
              </>
            ) : (
              <>
                {money(amt)} in {ticker} on {new Date(result.s.startT * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} would be worth{' '}
              </>
            )}
            <b className={`num ${result.s.gain >= 0 ? 'up' : 'down'}`}>{money(result.s.value)}</b> today.
          </p>
          <div className="whatif-grid">
            <div className="pt-table" role="group" aria-label="Comparison">
              <div className="pt-row wi-row pt-head">
                <span>In</span>
                <span className="num-col">Put in</span>
                <span className="num-col">Worth now</span>
                <span className="num-col">Gain</span>
                <span className="num-col">{kind === 'sip' ? 'XIRR' : 'CAGR'}</span>
              </div>
              {rows.map((r) => (
                <div key={r.name} className={`pt-row wi-row ${r.main ? 'main' : ''}`}>
                  <b>{r.name}</b>
                  <span className="num num-col">{money(r.invested)}</span>
                  <span className="num num-col">{money(r.value)}</span>
                  <span className={`num num-col ${r.value >= r.invested ? 'up' : 'down'}`}>
                    {signed(r.value - r.invested)} <span className="bd-pct">{formatPct((r.value / r.invested - 1) * 100)}</span>
                  </span>
                  <span className="num num-col">{r.annual == null ? '—' : `${r.annual.toFixed(1)}%`}</span>
                </div>
              ))}
            </div>
            <ValueChart stock={result.s} index={result.i} label={ticker} indexLabel={INDEX[market].name} currency={currency} />
          </div>
          <p className="card-sub tr-foot">
            {kind === 'sip' ? 'Buys on the first trading day of each month. XIRR is the yearly return that accounts for when each installment went in. ' : 'CAGR is the steady yearly growth that gives the same result. '}
            Split-adjusted closing prices; dividends, taxes and fees are not included, and the FD compounds quarterly. Past returns don't predict future ones.
          </p>
        </>
      )}
    </section>
  );
}
