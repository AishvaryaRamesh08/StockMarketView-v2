import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartToolbar } from './components/ChartToolbar.tsx';
import { IndexStrip, STRIP_INDICES } from './components/IndexStrip.tsx';
import { MarketStatusPill } from './components/MarketStatusPills.tsx';
import { PriceChart } from './components/PriceChart.tsx';
import { QuoteHeader } from './components/QuoteHeader.tsx';
import { SearchPalette, rememberRecent } from './components/SearchPalette.tsx';
import { useLiveChart } from './hooks/useLiveChart.ts';
import { useQuotes } from './hooks/useQuotes.ts';
import { digitsFor } from './lib/format.ts';
import { marketOf } from './lib/markets.ts';
import { intervalForPeriod, isIntervalId, isIntraday, isPeriodId, periodForInterval, type IntervalId, type PeriodId } from './lib/ranges.ts';
import { load, save } from './lib/storage.ts';

interface ChartPrefs {
  symbol: string;
  period: PeriodId;
  interval: IntervalId;
}

const PREFS_KEY = 'smv.chart';

function defaultSymbol(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta' ? 'RELIANCE.NS' : 'AAPL';
}

function isPrefs(v: unknown): v is ChartPrefs {
  const p = v as ChartPrefs;
  return !!p && typeof p.symbol === 'string' && isPeriodId(p.period) && isIntervalId(p.interval);
}

export function App() {
  const [prefs, setPrefs] = useState<ChartPrefs>(() => load(PREFS_KEY, { symbol: defaultSymbol(), period: '6mo', interval: '1d' }, isPrefs));
  const [searchOpen, setSearchOpen] = useState(false);
  const { symbol, period, interval } = prefs;

  useEffect(() => save(PREFS_KEY, prefs), [prefs]);

  const chart = useLiveChart(symbol, period, interval);
  // One batched request covers the index strip and the current symbol's day change.
  const quoteSymbols = useMemo(() => [...STRIP_INDICES.map((i) => i.symbol), symbol], [symbol]);
  const { quotes } = useQuotes(quoteSymbols);

  // Prefer the batched quote for day change (always computed against yesterday's close),
  // but the chart's own quote for price when it is newer.
  const live = quotes[symbol];
  const quote = useMemo(() => {
    const c = chart.quote;
    if (!c) return live ?? null;
    if (!live) return c;
    const newer = (c.marketTime ?? 0) >= (live.marketTime ?? 0) ? c : live;
    const prevClose = live.prevClose ?? c.prevClose;
    const change = newer.price != null && prevClose != null ? newer.price - prevClose : null;
    return { ...c, ...newer, name: c.name, exchange: c.exchange || live.exchange, prevClose, change, changePct: change != null && prevClose ? (change / prevClose) * 100 : null };
  }, [chart.quote, live]);

  const selectSymbol = useCallback((s: string) => {
    rememberRecent(s);
    setPrefs((p) => ({ ...p, symbol: s }));
  }, []);
  const setPeriod = useCallback((p: PeriodId) => setPrefs((x) => ({ ...x, period: p, interval: intervalForPeriod(p, x.interval) })), []);
  const setInterval = useCallback((i: IntervalId) => setPrefs((x) => ({ ...x, interval: i, period: periodForInterval(i, x.period) })), []);

  // Cmd/Ctrl+K or "/" opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.title = quote?.price != null ? `${symbol.replace(/\.(NS|BO)$/, '')} ${quote.price.toFixed(2)} · StockMarketView` : 'StockMarketView';
  }, [symbol, quote?.price]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => e.preventDefault()} aria-label="StockMarketView">
          <svg viewBox="0 0 32 32" aria-hidden>
            <rect x="5" y="12" width="4" height="12" rx="1" />
            <rect x="14" y="6" width="4" height="18" rx="1" />
            <rect x="23" y="15" width="4" height="9" rx="1" />
            <path d="M7 10v2M7 24v3M16 3v3M16 24v2M25 12v3M25 24v3" />
          </svg>
          <span>StockMarketView</span>
        </a>

        <button className="search-trigger" onClick={() => setSearchOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span>Search India &amp; US stocks</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <div className="topbar-status">
          <MarketStatusPill market="IN" />
          <MarketStatusPill market="US" />
        </div>
      </header>

      <IndexStrip quotes={quotes} active={symbol} onSelect={selectSymbol} />

      <main className="workspace">
        <QuoteHeader symbol={symbol} quote={quote} loading={chart.status === 'loading'} lastUpdated={chart.lastUpdated} refreshError={chart.error && chart.status === 'ready' ? chart.error : null} />
        <ChartToolbar period={period} interval={interval} onPeriod={setPeriod} onInterval={setInterval} />

        <section className="chart-panel" aria-label="Price chart">
          {chart.status === 'error' ? (
            <div className="chart-message">
              {chart.notFound ? (
                <>
                  <h2>We couldn't find “{symbol}”</h2>
                  <p>It may be delisted or spelled differently. Search by company name instead.</p>
                  <button className="btn primary" onClick={() => setSearchOpen(true)}>
                    Search stocks
                  </button>
                </>
              ) : (
                <>
                  <h2>Chart data didn't load</h2>
                  <p>{chart.error}</p>
                  <button className="btn primary" onClick={chart.retry}>
                    Try again
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {chart.status === 'loading' && <div className="chart-skeleton skeleton" aria-label="Loading chart" />}
              {chart.status === 'ready' && chart.candles.length === 0 && (
                <div className="chart-message">
                  <h2>No trades in this period yet</h2>
                  <p>Pick a longer period to see recent candles.</p>
                </div>
              )}
              <PriceChart
                candles={chart.candles}
                version={chart.version}
                timezone={quote?.timezone ?? (marketOf(symbol) === 'IN' ? 'Asia/Kolkata' : 'America/New_York')}
                currency={quote?.currency ?? 'USD'}
                digits={digitsFor(quote?.priceHint, quote?.price ?? null)}
                intraday={isIntraday(interval)}
              />
            </>
          )}
        </section>
      </main>

      <footer className="footer">
        Prices refresh every 30 seconds and may be delayed by the exchange. Nothing on this site is investment advice. Data: Yahoo Finance (unofficial). Times on the chart are exchange
        time.
      </footer>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={selectSymbol} />
    </div>
  );
}
