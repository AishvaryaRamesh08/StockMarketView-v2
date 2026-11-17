import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppearanceMenu } from './components/AppearanceMenu.tsx';
import { ChartActions, TextNoteInput } from './components/ChartActions.tsx';
import { ChartSummary, GlanceToggle } from './components/ChartSummary.tsx';
import { summarize } from './lib/summary.ts';
import type { TextRequest } from './components/drawingController.ts';
import { ChartToolbar } from './components/ChartToolbar.tsx';
import { IndexStrip, STRIP_INDICES } from './components/IndexStrip.tsx';
import { InfoTip } from './components/InfoTip.tsx';
import { MarketPulse } from './components/MarketPulse.tsx';
import { Portfolio } from './components/Portfolio.tsx';
import { TradePanel } from './components/TradePanel.tsx';
import { ChatPanel } from './components/ChatPanel.tsx';
import { useChat } from './hooks/useChat.ts';
import { useChatTools } from './hooks/useChatTools.ts';
import type { TradeLine, TradeMark } from './components/PriceChart.tsx';
import { MarketStatusPill } from './components/MarketStatusPills.tsx';
import { DEFAULT_FRAMES, MultiTimeframe, type Frame } from './components/MultiTimeframe.tsx';
import { ActiveOverlays, OverlayMenu } from './components/OverlayMenu.tsx';
import { PriceChart } from './components/PriceChart.tsx';
import { QuoteHeader } from './components/QuoteHeader.tsx';
import { SearchPalette, rememberRecent, type PaletteAction, type SearchMode } from './components/SearchPalette.tsx';
import { SimilarStocks } from './components/SimilarStocks.tsx';
import { WatchlistPanel } from './components/WatchlistPanel.tsx';
import { Welcome } from './components/Welcome.tsx';
import { useFillHeight } from './hooks/useFillHeight.ts';
import { useStickyPanels } from './hooks/useStickyPanels.ts';
import { MAX_COMPARE, useCompare } from './hooks/useCompare.ts';
import { useDailyPatterns } from './hooks/useDailyPatterns.ts';
import { useDrawings } from './hooks/useDrawings.ts';
import { usePaper } from './hooks/usePaper.ts';
import { openOrders, positionOf, type Order } from './lib/paper.ts';
import { useLiveChart } from './hooks/useLiveChart.ts';
import { useUniverse } from './hooks/useMarketData.ts';
import { useProfile } from './hooks/useProfile.ts';
import { useQuotes } from './hooks/useQuotes.ts';
import { useWatchlists } from './hooks/useWatchlists.ts';
import { chartPng, copyImage, downloadBlob } from './lib/chartImage.ts';
import { newId, type DrawTool } from './lib/drawings.ts';
import { digitsFor } from './lib/format.ts';
import { decodeLink, encodeLink, type LinkState } from './lib/shareUrl.ts';
import { previousSession, supportResistance, type Level } from './lib/levels.ts';
import { marketOf, sessionKeyFn } from './lib/markets.ts';
import { isMarketId } from './lib/marketData.ts';
import { DEFAULT_OVERLAYS, OVERLAYS, isOverlayId, type OverlayId } from './lib/overlays.ts';
import { setAppearance, useAppearance } from './lib/theme.ts';
import type { PatternId } from './lib/patterns.ts';
import { findPeers } from './lib/pulse.ts';
import type { MarketId } from './lib/types.ts';
import { INTERVALS, PERIODS, intervalForPeriod, isIntervalId, isIntraday, isPeriodId, periodForInterval, unsupportedReason, type IntervalId, type PeriodId } from './lib/ranges.ts';
import { load, save } from './lib/storage.ts';

type Layout = 'single' | 'multi';
type View = 'markets' | 'chart' | 'portfolio';

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
  portfolioMarket: MarketId;
  /** Trade panel beside the chart. */
  tradeOpen: boolean;
  /** Which tab the side panel shows. */
  sideTab: 'trade' | 'chat';
  /** "At a glance" summary expanded under the quote header. */
  glance: boolean;
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
  portfolioMarket: inIndia() ? 'IN' : 'US',
  tradeOpen: false,
  sideTab: 'trade',
  glance: false,
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
  if (raw.view === 'markets' || raw.view === 'chart' || raw.view === 'portfolio') p.view = raw.view;
  if (isMarketId(raw.portfolioMarket)) p.portfolioMarket = raw.portfolioMarket;
  if (typeof raw.tradeOpen === 'boolean') p.tradeOpen = raw.tradeOpen;
  if (typeof raw.glance === 'boolean') p.glance = raw.glance;
  if (raw.sideTab === 'trade' || raw.sideTab === 'chat') p.sideTab = raw.sideTab;
  if (isMarketId(raw.pulseMarket)) p.pulseMarket = raw.pulseMarket;
  return p;
}

/** A shared link overrides the saved session for what it specifies; everything else is kept. */
function applyLink(p: Prefs, link: LinkState | null): Prefs {
  if (!link) return p;
  if (link.view === 'markets') return { ...p, view: 'markets', pulseMarket: link.market ?? p.pulseMarket };
  if (link.view === 'portfolio') return { ...p, view: 'portfolio', portfolioMarket: link.market ?? p.portfolioMarket };
  const next: Prefs = { ...p, view: 'chart', symbol: link.symbol ?? p.symbol };
  if (link.period) next.period = link.period;
  if (link.interval) next.interval = link.interval;
  // A link may pair a period and interval that can't be served together; fix rather than fail.
  if (unsupportedReason(next.period, next.interval)) next.interval = intervalForPeriod(next.period, next.interval);
  if (link.overlays) next.overlays = link.overlays;
  if (link.compare) next.compare = link.compare;
  if (link.layout) next.layout = link.layout;
  return next;
}

function linkFor(p: Prefs): string {
  return encodeLink(
    p.view === 'markets'
      ? { view: 'markets', market: p.pulseMarket }
      : p.view === 'portfolio'
        ? { view: 'portfolio', market: p.portfolioMarket }
      : { view: 'chart', symbol: p.symbol, period: p.period, interval: p.interval, overlays: p.overlays, compare: p.compare, layout: p.layout },
  );
}

const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

export function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => applyLink(loadPrefs(), decodeLink(window.location.search)));
  const [search, setSearch] = useState<SearchMode | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { symbol, period, interval, layout } = prefs;
  const overlays = useMemo(() => new Set(prefs.overlays), [prefs.overlays]);
  const intraday = isIntraday(interval);

  useEffect(() => save(PREFS_KEY, prefs), [prefs]);
  // The address bar always describes the current view, so it can be copied and shared as is.
  useEffect(() => {
    const qs = linkFor(prefs);
    if (window.location.search !== `?${qs}`) window.history.replaceState(null, '', `${window.location.pathname}?${qs}`);
  }, [prefs]);

  const [toast, setToast] = useState<string | null>(null);
  // First visit: introduce the site, then briefly highlight the view tabs and the trade button.
  const [welcome, setWelcome] = useState(() => !load('smv.welcomed', false, (v): v is boolean => typeof v === 'boolean'));
  const [attention, setAttention] = useState(false);
  const closeWelcome = useCallback(() => {
    setWelcome(false);
    save('smv.welcomed', true);
    setAttention(true);
  }, []);
  useEffect(() => {
    if (!attention) return;
    const t = setTimeout(() => setAttention(false), 4200);
    return () => clearTimeout(t);
  }, [attention]);
  const chartPanel = useRef<HTMLElement>(null);
  // Maximized chart: only the top bar, the chart controls and the chart. Not remembered across visits.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Drawings for the open stock, the active tool, the selected drawing and a pending text note.
  // Paper trading. Fills are announced in a toast.
  const paper = usePaper((orders: Order[]) => {
    const f = orders.filter((o) => o.status === 'filled');
    const r = orders.filter((o) => o.status === 'rejected');
    if (f.length) setToast(`${f.map((o) => `${o.side === 'buy' ? 'Bought' : 'Sold'} ${o.qty} ${o.symbol.replace(/\.(NS|BO)$/, '')} at ${o.fillPrice?.toFixed(2)}`).join(', ')} (simulated)`);
    else if (r.length) setToast(`Order rejected: ${r[0].note ?? ''}`);
  });

  const draw = useDrawings(prefs.symbol);
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textReq, setTextReq] = useState<TextRequest | null>(null);
  const [capture, setCapture] = useState<(() => HTMLCanvasElement) | null>(null);
  useEffect(() => {
    setTool(null);
    setSelectedId(null);
    setTextReq(null);
  }, [prefs.symbol, prefs.layout, prefs.view]);
  const onScreenshotReady = useCallback((fn: (() => HTMLCanvasElement) | null) => setCapture(() => fn), []);

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

  // One batched quotes call (20 per request) covers the index strip, the open stock, the
  // watchlist, similar stocks and every paper-trading holding or working order.
  const quoteSymbols = useMemo(
    () => [...STRIP_INDICES.map((i) => i.symbol), symbol, ...wl.active.symbols, ...peers, ...paper.watchSymbols],
    [symbol, wl.active.symbols, peers, paper.watchSymbols],
  );
  const { quotes } = useQuotes(quoteSymbols);
  useEffect(() => paper.feed(quotes), [quotes, paper.feed]);

  // This stock's fills, working orders and average cost, for the chart.
  const trades: TradeMark[] = useMemo(
    () => paper.state.orders.filter((o) => o.symbol === symbol && o.status === 'filled').map((o) => ({ t: Math.floor((o.filledAt ?? o.createdAt) / 1000), side: o.side, qty: o.qty })),
    [paper.state.orders, symbol],
  );
  const tradeLines: TradeLine[] = useMemo(() => {
    const lines: TradeLine[] = openOrders(paper.state, symbol)
      .filter((o) => o.price != null)
      .map((o) => ({ price: o.price!, kind: o.side, title: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.type} ${o.qty}` }));
    const pos = positionOf(paper.state, symbol);
    if (pos) lines.push({ price: pos.avgCost, kind: 'avg', title: `Avg cost (${pos.qty})` });
    return lines;
  }, [paper.state, symbol]);
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

  const chatTools = useChatTools({
    prefs,
    name: quote?.name,
    update: (patch) => update(patch),
    selectSymbol: (sym) => {
      rememberRecent(sym);
      update((p) => ({ symbol: sym, compare: p.compare.filter((c) => c !== sym) }));
    },
    watchlist: { name: wl.active.name, symbols: wl.active.symbols, toggle: wl.toggle },
    maxCompare: MAX_COMPARE,
    portfolio: { state: paper.state, prices: paper.prices, quotes },
  });
  const chat = useChat(chatTools.execute, chatTools.system);

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

  // Drawing shortcuts: Esc cancels/deselects, Delete removes, Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z or Ctrl+Y redoes.
  useEffect(() => {
    if (prefs.view !== 'chart' || prefs.layout !== 'single') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (document.querySelector('.palette-backdrop')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        if (tool) setTool(null);
        else setSelectedId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        draw.remove(selectedId);
        setSelectedId(null);
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) draw.redo();
        else draw.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        draw.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prefs.view, prefs.layout, tool, selectedId, draw]);

  // F toggles the maximized chart; Esc leaves it once nothing else (a drawing tool, a selection) wants Esc.
  useEffect(() => {
    if (prefs.view !== 'chart') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (document.querySelector('.palette-backdrop, .welcome-backdrop')) return;
      if (e.key === 'Escape' && focus && !tool && !selectedId) setFocus(false);
      else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) setFocus((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prefs.view, focus, tool, selectedId]);

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
      { id: 'view-markets', label: 'Go to Markets', keywords: 'pulse movers gainers losers news headlines home overview', run: () => update({ view: 'markets' }) },
      { id: 'view-chart', label: 'Go to Chart', keywords: 'candles', run: () => update({ view: 'chart' }) },
      { id: 'view-portfolio', label: 'Go to Portfolio', keywords: 'paper trading holdings positions p&l account', run: () => update({ view: 'portfolio' }) },
      { id: 'help', label: 'What can this site do?', keywords: 'help about welcome guide tour features', run: () => setWelcome(true) },
      { id: 'focus', label: focus ? 'Exit full-screen chart' : 'Maximize chart', keywords: 'full screen fullscreen focus expand zoom', run: () => { update({ view: 'chart' }); setFocus((f) => !f); } },
      { id: 'trade', label: prefs.tradeOpen && prefs.sideTab === 'trade' ? 'Close trade panel' : `Paper trade ${symbol}`, keywords: 'buy sell order ticket paper', run: () => update((p) => ({ view: 'chart', tradeOpen: !(p.tradeOpen && p.sideTab === 'trade'), sideTab: 'trade' })) },
      { id: 'chat', label: 'Ask AI (chat with your charts)', keywords: 'chat gemini ai assistant bot voice question help', run: () => update({ tradeOpen: true, sideTab: 'chat' }) },
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
    [appearance, prefs.layout, prefs.sidebar, prefs.overlays, prefs.tradeOpen, prefs.sideTab, focus, symbol, watched, wl, update, toggleOverlay],
  );

  /* ------------------------------ image + share ------------------------------ */
  const imageBlob = useCallback(async () => {
    if (!capture) throw new Error('Chart not ready');
    const name = quote?.name ?? symbol;
    const ticker = symbol.replace(/\.(NS|BO)$/, '').replace(/^\^/, '');
    const periodLabel = PERIODS.find((x) => x.id === period)?.label ?? period;
    const intervalLabel = INTERVALS.find((x) => x.id === interval)?.label ?? interval;
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const price = quote?.price != null ? ` · last ${quote.price.toFixed(2)} ${quote.currency}` : '';
    return chartPng(capture(), { title: `${name} (${ticker})`, detail: `${quote?.exchange ?? ''} · ${periodLabel}, ${intervalLabel} candles · ${date}${price}` });
  }, [capture, quote, symbol, period, interval]);

  const fileName = () => `${symbol.replace(/[^A-Za-z0-9.-]/g, '')}-${period}-${interval}-${new Date().toISOString().slice(0, 10)}.png`;
  const onDownload = async () => {
    try {
      downloadBlob(await imageBlob(), fileName());
      setToast('Image downloaded');
    } catch {
      setToast("Couldn't create the image");
    }
  };
  const onCopyImage = async () => {
    try {
      setToast((await copyImage(await imageBlob())) ? 'Image copied to clipboard' : "This browser doesn't allow copying images; use Download instead");
    } catch {
      setToast("Couldn't create the image");
    }
  };
  const onShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${linkFor(prefs)}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link copied. Drawings stay on this device; share them as an image.');
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const saveNote = (text: string) => {
    if (!textReq) return;
    if (textReq.id) draw.commit(draw.drawings.map((d) => (d.id === textReq.id ? { ...d, text } : d)));
    else {
      const id = newId();
      draw.commit([...draw.drawings, { id, tool: 'text', a: textReq.point, text }]);
      setSelectedId(id);
    }
    setTextReq(null);
    setTool(null);
  };

  const drawingProps = useMemo(
    () => ({
      drawings: draw.drawings,
      tool,
      selectedId,
      onCommit: draw.commit,
      onSelect: setSelectedId,
      onToolDone: () => setTool(null),
      onTextRequest: setTextReq,
    }),
    [draw.drawings, draw.commit, tool, selectedId],
  );

  // The side panel: Trade needs a stock on screen; Chat works from any page.
  const tradeVisible = prefs.tradeOpen && (prefs.view === 'chart' || prefs.sideTab === 'chat');
  const sideTab = prefs.view === 'chart' ? prefs.sideTab : 'chat';
  const openSide = (tab: 'trade' | 'chat') => update((p) => ({ tradeOpen: !(p.tradeOpen && p.sideTab === tab), sideTab: tab }));
  const focusMode = focus && prefs.view === 'chart';
  const glanceParts = useMemo(() => (chart.status === 'ready' ? summarize(chart.candles, interval, quote?.high52) : []), [chart.status, chart.candles, interval, quote?.high52]);
  useStickyPanels();
  useFillHeight(chartPanel, 320, focusMode ? 12 : 16, [prefs.view, layout, chart.status === 'error', focusMode]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const panel = (onClose?: () => void) => (
    <WatchlistPanel wl={wl} quotes={quotes} patterns={badges} current={symbol} onSelect={selectSymbol} onAdd={() => setSearch('watchlist')} onClose={onClose} />
  );

  return (
    <div className={`app ${focusMode ? 'focus-mode' : ''}`}>
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

        <nav className={`view-tabs ${attention ? 'attention' : ''}`} aria-label="Views">
          <button className={prefs.view === 'markets' ? 'active' : ''} aria-current={prefs.view === 'markets' ? 'page' : undefined} onClick={() => update({ view: 'markets' })} title="Today's market overview">
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z" />
            </svg>
            Markets
          </button>
          <button className={prefs.view === 'chart' ? 'active' : ''} aria-current={prefs.view === 'chart' ? 'page' : undefined} onClick={() => update({ view: 'chart' })} title="Live chart of the selected stock">
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M3 15l4-5 3 3 7-8M3 18h14" />
            </svg>
            Chart<span className="view-sym"> · {symbol.replace(/\.(NS|BO)$/, '').replace(/^\^/, '')}</span>
          </button>
          <button className={prefs.view === 'portfolio' ? 'active' : ''} aria-current={prefs.view === 'portfolio' ? 'page' : undefined} onClick={() => update({ view: 'portfolio' })} title="Your paper trading account">
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M3 7h14v10H3zM7 7V4h6v3M3 11h14" />
            </svg>
            Portfolio
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
          <button
            className={`ask-ai-btn ${prefs.tradeOpen && sideTab === 'chat' ? 'pressed' : ''} ${attention ? 'attention' : ''}`}
            onClick={() => (prefs.view !== 'chart' && prefs.tradeOpen && prefs.sideTab === 'chat' ? update({ tradeOpen: false }) : openSide('chat'))}
            aria-pressed={prefs.tradeOpen && sideTab === 'chat'}
            title="Ask AI: draw charts and explain them from plain English or voice (uses your own Gemini key)"
          >
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
            </svg>
            <span className="btn-label">Ask AI</span>
          </button>
          <button className="icon-btn help-btn" onClick={() => setWelcome(true)} aria-label="What can this site do?" title="What can this site do?">
            ?
          </button>
          <AppearanceMenu />
          <MarketStatusPill market="IN" />
          <MarketStatusPill market="US" />
        </div>
      </header>

      {!focusMode && <IndexStrip quotes={quotes} active={symbol} onSelect={selectSymbol} />}

      <div className={`body ${prefs.sidebar && !focusMode ? 'with-sidebar' : ''} ${tradeVisible ? 'with-trade' : ''}`}>
        {prefs.sidebar && !focusMode && <div className="sidebar-desktop">{panel()}</div>}

        {prefs.view === 'markets' ? (
          <main className="workspace">
            <MarketPulse market={prefs.pulseMarket} onMarket={(m) => update({ pulseMarket: m })} onOpen={openFromPulse} />
          </main>
        ) : prefs.view === 'portfolio' ? (
          <main className="workspace">
            <Portfolio
              market={prefs.portfolioMarket}
              onMarket={(m) => update({ portfolioMarket: m })}
              paper={paper}
              quotes={quotes}
              onOpen={selectSymbol}
              onToast={setToast}
              onAnalyse={(m) => {
                update({ tradeOpen: true, sideTab: 'chat' });
                if (chat.hasKey && !chat.busy) chat.send(`Analyse my ${m === 'IN' ? 'India (₹)' : 'US ($)'} paper portfolio: what's doing well and what isn't?`);
              }}
            />
          </main>
        ) : (
        <main className="workspace">
          {!focusMode && (
            <>
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
                extra={<GlanceToggle parts={glanceParts} open={prefs.glance} onToggle={() => update((p) => ({ glance: !p.glance }))} />}
              />
              {prefs.glance && <ChartSummary parts={glanceParts} />}
            </>
          )}


          <div className="toolbar-row">
            {layout === 'single' ? <ChartToolbar period={period} interval={interval} onPeriod={setPeriod} onInterval={setInterval} /> : <div className="toolbar-hint">Each chart has its own period and interval. Move the crosshair on one to line up all three.</div>}
          </div>

          <div className="actions-row">
            <div className="tools">
              <button
                className={`tool-btn trade-btn ${prefs.tradeOpen && prefs.sideTab === 'trade' ? 'pressed' : ''} ${attention ? 'attention' : ''}`}
                onClick={() => openSide('trade')}
                aria-pressed={prefs.tradeOpen && prefs.sideTab === 'trade'}
                title="Practise buying and selling this stock with virtual money"
              >
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="M4 14l4-4 3 3 5-6M13 7h3v3" />
                </svg>
                {prefs.tradeOpen && prefs.sideTab === 'trade' ? (
                  'Close trade'
                ) : (
                  <>
                    <span className="label-long">Paper trade</span>
                    <span className="label-short">Trade</span>
                  </>
                )}
              </button>
              <OverlayMenu active={overlays} intraday={intraday} barCount={chart.candles.length} onToggle={toggleOverlay} onClear={() => update({ overlays: [] })} />
              {layout === 'single' && (
                <button className="tool-btn" aria-label="Compare with other stocks" onClick={() => setSearch('compare')} disabled={prefs.compare.length >= MAX_COMPARE} title={prefs.compare.length >= MAX_COMPARE ? `Up to ${MAX_COMPARE} comparisons` : 'Overlay other stocks as % change'}>
                  <svg viewBox="0 0 20 20" aria-hidden>
                    <path d="M3 14l4-5 3 3 6-7M3 17h14" />
                  </svg>
                  <span className="btn-label">Compare</span>
                </button>
              )}
              <div className="segmented layout-toggle" role="radiogroup" aria-label="Layout">
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
            {layout === 'single' && chart.status !== 'error' && (
              <ChartActions
                tool={tool}
                onTool={(t) => {
                  setTool(t);
                  setSelectedId(null);
                }}
                hasSelection={!!selectedId}
                drawingCount={draw.drawings.length}
                canUndo={draw.canUndo}
                canRedo={draw.canRedo}
                onUndo={draw.undo}
                onRedo={draw.redo}
                onDelete={() => {
                  if (selectedId) draw.remove(selectedId);
                  setSelectedId(null);
                }}
                onClear={() => {
                  draw.clear();
                  setSelectedId(null);
                }}
                onDownload={onDownload}
                onCopyImage={onCopyImage}
                onShare={onShare}
              />
            )}
            <button
              className={`tool-btn focus-btn ${focusMode ? 'pressed' : ''}`}
              onClick={() => setFocus((f) => !f)}
              aria-pressed={focusMode}
              aria-label={focusMode ? 'Exit full-screen chart' : 'Maximize chart'}
              title={focusMode ? 'Exit full-screen chart (Esc or F)' : 'Maximize chart (F)'}
            >
              <svg viewBox="0 0 20 20" aria-hidden>
                {focusMode ? <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" /> : <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />}
              </svg>
            </button>
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
            <section className="chart-panel" aria-label="Price chart" ref={chartPanel}>
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
                    drawing={drawingProps}
                    onScreenshotReady={onScreenshotReady}
                    trades={trades}
                    tradeLines={tradeLines}
                  />
                  {textReq && <TextNoteInput key={`${textReq.x},${textReq.y}`} x={textReq.x} y={textReq.y} initial={textReq.initial} onSave={saveNote} onCancel={() => setTextReq(null)} />}
                </>
              )}
            </section>
          )}

          {layout === 'single' && !focusMode && (
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

        {tradeVisible && (
          <div className="trade-dock" onMouseDown={(e) => e.target === e.currentTarget && update({ tradeOpen: false })}>
            <div className="side-panel">
              <div className="side-tabs" role="tablist" aria-label="Side panel">
                {prefs.view === 'chart' && (
                  <button role="tab" aria-selected={sideTab === 'trade'} className={sideTab === 'trade' ? 'active' : ''} onClick={() => update({ sideTab: 'trade' })}>
                    Trade
                  </button>
                )}
                <button role="tab" aria-selected={sideTab === 'chat'} className={sideTab === 'chat' ? 'active' : ''} onClick={() => update({ sideTab: 'chat' })}>
                  Ask AI
                </button>
                <button className="icon-btn side-close" onClick={() => update({ tradeOpen: false })} aria-label="Close panel" title="Close">
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              {sideTab === 'trade' ? (
                <TradePanel
                  symbol={symbol}
                  market={marketOf(symbol)}
                  quote={quote}
                  paper={paper}
                  onToast={setToast}
                  onOpenPortfolio={() => update({ view: 'portfolio', portfolioMarket: marketOf(symbol) })}
                />
              ) : (
                <ChatPanel chat={chat} />
              )}
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {!focusMode && (
        <footer className="footer">
          Prices refresh every 30 seconds and may be delayed by the exchange. Nothing on this site is investment advice. Data: Yahoo Finance (unofficial). Chart times are exchange time.
        </footer>
      )}

      {sheetOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setSheetOpen(false)}>
          <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
            {panel(() => setSheetOpen(false))}
          </div>
        </div>
      )}

      {welcome && (
        <Welcome
          searchKey={`${isMac ? '⌘' : 'Ctrl'} K`}
          onClose={closeWelcome}
          onGo={(view) => {
            closeWelcome();
            update({ view });
          }}
        />
      )}

      <SearchPalette open={search != null} actions={actions} mode={search ?? 'chart'} context={search === 'watchlist' ? wl.active.name : undefined} onClose={() => setSearch(null)} onSelect={onSearchSelect} />
    </div>
  );
}
