import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppearanceMenu } from './components/AppearanceMenu.tsx';
import { ChartSummary } from './components/ChartSummary.tsx';
import { ChartToolbar } from './components/ChartToolbar.tsx';
import { IndexStrip, STRIP_INDICES } from './components/IndexStrip.tsx';
import { InfoTip } from './components/InfoTip.tsx';
import { MarketPulse } from './components/MarketPulse.tsx';
import { MarketStatusPill } from './components/MarketStatusPills.tsx';
import { DEFAULT_FRAMES, MultiTimeframe, type Frame } from './components/MultiTimeframe.tsx';
import { ActiveOverlays, OverlayMenu } from './components/OverlayMenu.tsx';
import { PriceChart } from './components/PriceChart.tsx';
import { QuoteHeader } from './components/QuoteHeader.tsx';
import { SearchPalette, rememberRecent, type PaletteAction, type SearchMode } from './components/SearchPalette.tsx';
import { SimilarStocks } from './components/SimilarStocks.tsx';
import { WatchlistPanel } from './components/WatchlistPanel.tsx';
import { MAX_COMPARE, useCompare } from './hooks/useCompare.ts';
import { useDailyPatterns } from './hooks/useDailyPatterns.ts';
import { useLiveChart } from './hooks/useLiveChart.ts';
import { useUniverse } from './hooks/useMarketData.ts';
import { useProfile } from './hooks/useProfile.ts';
import { useQuotes } from './hooks/useQuotes.ts';
import { useWatchlists } from './hooks/useWatchlists.ts';
import { digitsFor } from './lib/format.ts';
import { previousSession, supportResistance, type Level } from './lib/levels.ts';
import { marketOf, sessionKeyFn } from './lib/markets.ts';
import { isMarketId } from './lib/marketData.ts';
import { DEFAULT_OVERLAYS, OVERLAYS, isOverlayId, type OverlayId } from './lib/overlays.ts';
import { setAppearance, useAppearance } from './lib/theme.ts';
import type { PatternId } from './lib/patterns.ts';
import { findPeers } from './lib/pulse.ts';
import type { MarketId } from './lib/types.ts';
import { intervalForPeriod, isIntervalId, isIntraday, isPeriodId, periodForInterval, type IntervalId, type PeriodId } from './lib/ranges.ts';
import { load, save } from './lib/storage.ts';

type Layout = 'single' | 'multi';
type View = 'markets' | 'chart';

interface Prefs {
  symbol: string;
  period: PeriodId;
  interval: IntervalId;
  overlays: OverlayId[];
  compare: string[];
  layout: Layout;
  frames: Frame[];
  sidebar: boolean;
  view: View;
  pulseMarket: MarketId;
}

const PREFS_KEY = 'smv.chart';

function inIndia(): boolean {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta';
}

function defaultSymbol(): string {
  return inIndia() ? 'RELIANCE.NS' : 'AAPL';
}

const DEFAULT_PREFS: Prefs = {
  symbol: defaultSymbol(),
  period: '6mo',
  interval: '1d',
  overlays: DEFAULT_OVERLAYS,
  compare: [],
  layout: 'single',
  frames: DEFAULT_FRAMES,
  sidebar: true,
  // First-time visitors land on the market overview, not an arbitrary stock.
  view: 'markets',
  pulseMarket: inIndia() ? 'IN' : 'US',
};

/** Accepts prefs saved by older versions (Phase 1 saved only symbol/period/interval). */
function loadPrefs(): Prefs {
  const raw = load<Record<string, unknown>>(PREFS_KEY, {}, (v): v is Record<string, unknown> => !!v && typeof v === 'object');
  const p: Prefs = { ...DEFAULT_PREFS };
  if (typeof raw.symbol === 'string') p.symbol = raw.symbol;
  if (isPeriodId(raw.period)) p.period = raw.period;
  if (isIntervalId(raw.interval)) p.interval = raw.interval;
  if (Array.isArray(raw.overlays)) p.overlays = raw.overlays.filter(isOverlayId);
  if (Array.isArray(raw.compare)) p.compare = raw.compare.filter((s): s is string => typeof s === 'string').slice(0, MAX_COMPARE);
  if (raw.layout === 'single' || raw.layout === 'multi') p.layout = raw.layout;
  if (Array.isArray(raw.frames) && raw.frames.length === 3 && raw.frames.every((f) => isPeriodId(f?.period) && isIntervalId(f?.interval))) p.frames = raw.frames as Frame[];
  if (typeof raw.sidebar === 'boolean') p.sidebar = raw.sidebar;
  if (raw.view === 'markets' || raw.view === 'chart') p.view = raw.view;
  if (isMarketId(raw.pulseMarket)) p.pulseMarket = raw.pulseMarket;
  return p;
}

const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

export function App() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [search, setSearch] = useState<SearchMode | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { symbol, period, interval, layout } = prefs;
  const overlays = useMemo(() => new Set(prefs.overlays), [prefs.overlays]);
  const intraday = isIntraday(interval);

  useEffect(() => save(PREFS_KEY, prefs), [prefs]);

  const wl = useWatchlists();
  const chart = useLiveChart(symbol, period, interval);
  const profile = useProfile(symbol);
  const { lines: compareLines, failed: compareFailed } = useCompare(prefs.compare, period, interval);

  // One batched quotes call (in chunks of 20) covers the index strip, the open stock and the watchlist.
  // Peers: same industry within the NIFTY 500 / S&P 500, or Yahoo's related symbols for anything else.
  const universe = useUniverse(marketOf(symbol));
  const { peers, peerBasis } = useMemo(() => {
    const fromIndex = universe ? findPeers(symbol, universe).map((e) => e.s) : [];
    if (fromIndex.length) return { peers: fromIndex, peerBasis: 'industry' as const };
    const related = (profile?.related ?? []).filter((s) => s !== symbol && marketOf(s) === marketOf(symbol)).slice(0, 6);
    return { peers: related, peerBasis: 'related' as const };
  }, [universe, profile?.related, symbol]);

  const quoteSymbols = useMemo(() => [...STRIP_INDICES.map((i) => i.symbol), symbol, ...wl.active.symbols, ...peers], [symbol, wl.active.symbols, peers]);
  const { quotes } = useQuotes(quoteSymbols);
  const badges = useDailyPatterns(wl.active.symbols);

  // Prefer the batched quote for day change (always against yesterday's close).
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

  const timezone = quote?.timezone ?? (marketOf(symbol) === 'IN' ? 'Asia/Kolkata' : 'America/New_York');

  const levels = useMemo(() => {
    const out: Level[] = [];
    if (overlays.has('lvl52w') && quote?.high52 != null && quote.low52 != null) {
      out.push({ kind: 'high52', price: quote.high52, label: '52-week high' }, { kind: 'low52', price: quote.low52, label: '52-week low' });
    }
    if (overlays.has('lvlPrev')) {
      const prev = previousSession(chart.candles, intraday, sessionKeyFn(timezone));
      if (prev) out.push({ kind: 'prevHigh', price: prev.high, label: 'Previous high' }, { kind: 'prevLow', price: prev.low, label: 'Previous low' });
    }
    if (overlays.has('lvlSR')) out.push(...supportResistance(chart.candles));
    return out;
  }, [overlays, quote?.high52, quote?.low52, chart.candles, intraday, timezone]);

  const update = useCallback((patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => setPrefs((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) })), []);
  const selectSymbol = useCallback(
    (s: string) => {
      rememberRecent(s);
      update((p) => ({ symbol: s, view: 'chart', compare: p.compare.filter((c) => c !== s) }));
      setSheetOpen(false);
    },
    [update],
  );
  const setPeriod = useCallback((p: PeriodId) => update((x) => ({ period: p, interval: intervalForPeriod(p, x.interval) })), [update]);
  const setInterval = useCallback((i: IntervalId) => update((x) => ({ interval: i, period: periodForInterval(i, x.period) })), [update]);
  const toggleOverlay = useCallback((id: OverlayId) => update((p) => ({ overlays: p.overlays.includes(id) ? p.overlays.filter((o) => o !== id) : [...p.overlays, id] })), [update]);

  // From the pulse page; a pattern from the feed opens the daily chart with that pattern marked.
  const openFromPulse = useCallback(
    (s: string, pattern?: PatternId) => {
      selectSymbol(s);
      if (pattern) {
        update((p) => ({
          overlays: p.overlays.includes(pattern) ? p.overlays : [...p.overlays, pattern],
          ...(p.interval === '1d' ? {} : { period: '3mo' as PeriodId, interval: '1d' as IntervalId }),
          layout: 'single',
        }));
      }
    },
    [selectSymbol, update],
  );

  const onSearchSelect = (s: string) => {
    if (search === 'compare') update((p) => ({ compare: s === p.symbol || p.compare.includes(s) ? p.compare : [...p.compare, s].slice(0, MAX_COMPARE) }));
    else if (search === 'watchlist') {
      if (!wl.active.symbols.includes(s)) wl.toggle(s);
    } else selectSymbol(s);
  };

  // Cmd/Ctrl+K or "/" opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setSearch('chart');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.title = quote?.price != null ? `${symbol.replace(/\.(NS|BO)$/, '')} ${quote.price.toFixed(2)} · StockMarketView` : 'StockMarketView';
  }, [symbol, quote?.price]);

  const watched = wl.active.symbols.includes(symbol);
  const appearance = useAppearance();
  const actions: PaletteAction[] = useMemo(
    () => [
      { id: 'view-markets', label: 'Go to Markets', keywords: 'pulse heatmap movers home overview', run: () => update({ view: 'markets' }) },
      { id: 'view-chart', label: 'Go to Chart', keywords: 'candles', run: () => update({ view: 'chart' }) },
      { id: 'market-in', label: 'Markets: show India', keywords: 'nifty nse', run: () => update({ view: 'markets', pulseMarket: 'IN' }) },
      { id: 'market-us', label: 'Markets: show US', keywords: 's&p nasdaq nyse', run: () => update({ view: 'markets', pulseMarket: 'US' }) },
      appearance.theme === 'dark'
        ? { id: 'theme', label: 'Switch to light theme', keywords: 'appearance mode white', run: () => setAppearance({ theme: 'light' }) }
        : { id: 'theme', label: 'Switch to dark theme', keywords: 'appearance mode black night', run: () => setAppearance({ theme: 'dark' }) },
      appearance.palette === 'classic'
        ? { id: 'palette', label: 'Use blue / orange colours (colour-blind friendly)', keywords: 'color blind accessibility palette', run: () => setAppearance({ palette: 'cb' }) }
        : { id: 'palette', label: 'Use green / red colours', keywords: 'color palette classic', run: () => setAppearance({ palette: 'classic' }) },
      prefs.layout === 'single'
        ? { id: 'layout', label: 'Multi-timeframe view (three charts)', keywords: 'layout mtf split', run: () => update({ view: 'chart', layout: 'multi' }) }
        : { id: 'layout', label: 'Single chart view', keywords: 'layout one', run: () => update({ view: 'chart', layout: 'single' }) },
      { id: 'sidebar', label: prefs.sidebar ? 'Hide watchlist' : 'Show watchlist', keywords: 'sidebar panel', run: () => update((p) => ({ sidebar: !p.sidebar })) },
      { id: 'compare', label: 'Compare with another stock…', keywords: 'overlay versus vs', run: () => setTimeout(() => setSearch('compare'), 0) },
      { id: 'watch', label: watched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`, keywords: 'star save follow', run: () => wl.toggle(symbol) },
      { id: 'clear', label: 'Remove all indicators', keywords: 'clear overlays reset', run: () => update({ overlays: [] }) },
      ...OVERLAYS.map((o) => ({
        id: `ov-${o.id}`,
        label: `${prefs.overlays.includes(o.id) ? 'Hide' : 'Show'} ${o.label}`,
        keywords: `${o.group} indicator pattern toggle add remove`,
        run: () => {
          toggleOverlay(o.id);
          update({ view: 'chart' });
        },
      })),
    ],
    [appearance, prefs.layout, prefs.sidebar, prefs.overlays, symbol, watched, wl, update, toggleOverlay],
  );

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const panel = (onClose?: () => void) => (
    <WatchlistPanel wl={wl} quotes={quotes} patterns={badges} current={symbol} onSelect={selectSymbol} onAdd={() => setSearch('watchlist')} onClose={onClose} />
  );

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="icon-btn sidebar-toggle"
          onClick={() => (isNarrow() ? setSheetOpen((o) => !o) : update((p) => ({ sidebar: !p.sidebar })))}
          aria-label="Toggle watchlist"
          title="Watchlist"
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </button>
        <a className="brand" href="/" onClick={(e) => e.preventDefault()} aria-label="StockMarketView">
          <svg viewBox="0 0 32 32" aria-hidden>
            <rect x="5" y="12" width="4" height="12" rx="1" />
            <rect x="14" y="6" width="4" height="18" rx="1" />
            <rect x="23" y="15" width="4" height="9" rx="1" />
            <path d="M7 10v2M7 24v3M16 3v3M16 24v2M25 12v3M25 24v3" />
          </svg>
          <span>StockMarketView</span>
        </a>

        <nav className="view-tabs" aria-label="Views">
          <button className={prefs.view === 'markets' ? 'active' : ''} aria-current={prefs.view === 'markets' ? 'page' : undefined} onClick={() => update({ view: 'markets' })}>
            Markets
          </button>
          <button className={prefs.view === 'chart' ? 'active' : ''} aria-current={prefs.view === 'chart' ? 'page' : undefined} onClick={() => update({ view: 'chart' })}>
            Chart<span className="view-sym"> · {symbol.replace(/\.(NS|BO)$/, '').replace(/^\^/, '')}</span>
          </button>
        </nav>

        <button className="search-trigger" onClick={() => setSearch('chart')}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span>Search India &amp; US stocks</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <div className="topbar-status">
          <AppearanceMenu />
          <MarketStatusPill market="IN" />
          <MarketStatusPill market="US" />
        </div>
      </header>

      <IndexStrip quotes={quotes} active={symbol} onSelect={selectSymbol} />

      <div className={`body ${prefs.sidebar ? 'with-sidebar' : ''}`}>
        {prefs.sidebar && <div className="sidebar-desktop">{panel()}</div>}

        {prefs.view === 'markets' ? (
          <main className="workspace">
            <MarketPulse market={prefs.pulseMarket} onMarket={(m) => update({ pulseMarket: m })} onOpen={openFromPulse} />
          </main>
        ) : (
        <main className="workspace">
          <QuoteHeader
            symbol={symbol}
            quote={quote}
            profile={profile}
            loading={chart.status === 'loading'}
            lastUpdated={chart.lastUpdated}
            refreshError={chart.error && chart.status === 'ready' ? chart.error : null}
            watched={watched}
            watchlistName={wl.active.name}
            onToggleWatch={() => wl.toggle(symbol)}
          />

          {chart.status === 'ready' && <ChartSummary candles={chart.candles} interval={interval} high52={quote?.high52} />}

          <div className="toolbar-row">
            {layout === 'single' ? <ChartToolbar period={period} interval={interval} onPeriod={setPeriod} onInterval={setInterval} /> : <div className="toolbar-hint">Each chart has its own period and interval. Move the crosshair on one to line up all three.</div>}
            <div className="tools">
              <OverlayMenu active={overlays} intraday={intraday} barCount={chart.candles.length} onToggle={toggleOverlay} onClear={() => update({ overlays: [] })} />
              {layout === 'single' && (
                <button className="tool-btn" onClick={() => setSearch('compare')} disabled={prefs.compare.length >= MAX_COMPARE} title={prefs.compare.length >= MAX_COMPARE ? `Up to ${MAX_COMPARE} comparisons` : 'Overlay other stocks as % change'}>
                  <svg viewBox="0 0 20 20" aria-hidden>
                    <path d="M3 14l4-5 3 3 6-7M3 17h14" />
                  </svg>
                  Compare
                </button>
              )}
              <div className="segmented" role="radiogroup" aria-label="Layout">
                <button role="radio" aria-checked={layout === 'single'} className={layout === 'single' ? 'active' : ''} onClick={() => update({ layout: 'single' })} title="One chart">
                  <svg viewBox="0 0 20 20" aria-hidden>
                    <rect x="3" y="4" width="14" height="12" rx="1.5" />
                  </svg>
                </button>
                <button role="radio" aria-checked={layout === 'multi'} className={layout === 'multi' ? 'active' : ''} onClick={() => update({ layout: 'multi' })} title="Multi-timeframe: three charts side by side">
                  <svg viewBox="0 0 20 20" aria-hidden>
                    <rect x="2" y="4" width="4.5" height="12" rx="1" />
                    <rect x="7.75" y="4" width="4.5" height="12" rx="1" />
                    <rect x="13.5" y="4" width="4.5" height="12" rx="1" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {(overlays.size > 0 || (layout === 'single' && prefs.compare.length > 0)) && (
            <div className="chip-rows">
              {layout === 'single' && prefs.compare.length > 0 && (
                <div className="active-overlays">
                  <span className="row-label">Comparing</span>
                  {prefs.compare.map((s) => {
                    const line = compareLines.find((l) => l.symbol === s);
                    const bad = compareFailed.includes(s);
                    return (
                      <InfoTip key={s} text={bad ? "Couldn't load this symbol." : 'Shown as % change from the first visible candle, so stocks at very different prices line up.'}>
                        <span className={`overlay-chip ${bad ? 'muted' : ''}`} tabIndex={0}>
                          <span className="swatch" style={{ background: line?.color ?? 'var(--text-3)' }} />
                          {line?.label ?? s.replace(/\.(NS|BO)$/, '').replace(/^\^/, '')}
                          <button className="chip-x" onClick={() => update((p) => ({ compare: p.compare.filter((c) => c !== s) }))} aria-label={`Stop comparing ${s}`}>
                            ×
                          </button>
                        </span>
                      </InfoTip>
                    );
                  })}
                </div>
              )}
              <ActiveOverlays active={overlays} intraday={intraday} barCount={chart.candles.length} onToggle={toggleOverlay} />
            </div>
          )}

          {layout === 'multi' ? (
            <MultiTimeframe symbol={symbol} frames={prefs.frames} overlays={overlays} onFramesChange={(frames) => update({ frames })} />
          ) : (
            <section className="chart-panel" aria-label="Price chart">
              {chart.status === 'error' ? (
                <div className="chart-message">
                  {chart.notFound ? (
                    <>
                      <h2>We couldn't find “{symbol}”</h2>
                      <p>It may be delisted or spelled differently. Search by company name instead.</p>
                      <button className="btn primary" onClick={() => setSearch('chart')}>
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
                    timezone={timezone}
                    currency={quote?.currency ?? 'USD'}
                    digits={digitsFor(quote?.priceHint, quote?.price ?? null)}
                    intraday={intraday}
                    overlays={overlays}
                    events={chart.events}
                    levels={levels}
                    compare={compareLines}
                    lastBarLive={chart.marketOpen}
                  />
                </>
              )}
            </section>
          )}

          {layout === 'single' && (
            <SimilarStocks
              peers={peers}
              basis={peerBasis}
              quotes={quotes}
              comparing={prefs.compare}
              canCompare={prefs.compare.length < MAX_COMPARE}
              onOpen={selectSymbol}
              onCompare={(s) => update((p) => ({ compare: p.compare.includes(s) ? p.compare.filter((c) => c !== s) : [...p.compare, s].slice(0, MAX_COMPARE) }))}
            />
          )}
        </main>
        )}
      </div>

      <footer className="footer">
        Prices refresh every 30 seconds and may be delayed by the exchange. Nothing on this site is investment advice. Data: Yahoo Finance (unofficial). Chart times are exchange time.
      </footer>

      {sheetOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setSheetOpen(false)}>
          <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
            {panel(() => setSheetOpen(false))}
          </div>
        </div>
      )}

      <SearchPalette open={search != null} actions={actions} mode={search ?? 'chart'} context={search === 'watchlist' ? wl.active.name : undefined} onClose={() => setSearch(null)} onSelect={onSearchSelect} />
    </div>
  );
}
