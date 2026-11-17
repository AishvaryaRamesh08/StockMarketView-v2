import { useCallback, useRef } from 'react';
import { fetchChart, fetchQuotes } from '../lib/api.ts';
import { fitRange, periodFor, resolveTicker, systemPrompt, toInterval, toOverlay, toPeriod, type ChatContext } from '../lib/chatTools.ts';
import type { FunctionCall, ToolOutcome } from '../lib/gemini.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import { OVERLAY_BY_ID, type OverlayId } from '../lib/overlays.ts';
import { INTERVALS, PERIODS, type IntervalId, type PeriodId } from '../lib/ranges.ts';
import { loadSymbols, type SymbolEntry } from '../lib/search.ts';
import { summarize } from '../lib/summary.ts';
import type { MarketId, Quote } from '../lib/types.ts';
import type { Frame } from '../components/MultiTimeframe.tsx';

/** The part of the page state the chatbot reads and changes. */
export interface ChatPrefs {
  symbol: string;
  period: PeriodId;
  interval: IntervalId;
  overlays: OverlayId[];
  compare: string[];
  layout: 'single' | 'multi';
  view: 'markets' | 'chart' | 'portfolio';
}

interface Deps {
  prefs: ChatPrefs;
  name?: string;
  update: (patch: Partial<ChatPrefs> & { frames?: Frame[]; pulseMarket?: MarketId }) => void;
  selectSymbol: (s: string) => void;
  watchlist: { name: string; symbols: string[]; toggle: (s: string) => void };
  maxCompare: number;
}

const periodLabel = (p: PeriodId) => PERIODS.find((x) => x.id === p)!.label;
const intervalLabel = (i: IntervalId) => ({ '1d': 'daily', '1wk': 'weekly', '1mo': 'monthly' } as Record<string, string>)[i] ?? INTERVALS.find((x) => x.id === i)!.label;
const short = (s: string) => s.replace(/\.(NS|BO)$/, '').replace(/^\^/, '');

function quoteFacts(q: Quote) {
  return {
    symbol: q.symbol,
    name: q.name,
    currency: q.currency,
    price: q.price,
    change: q.change,
    changePct: q.changePct == null ? null : Math.round(q.changePct * 100) / 100,
    previousClose: q.prevClose,
    dayLow: q.dayLow,
    dayHigh: q.dayHigh,
    volume: q.volume,
    week52Low: q.low52,
    week52High: q.high52,
    lastTrade: q.marketTime ? new Date(q.marketTime * 1000).toISOString() : null,
    market: marketStatus(marketOf(q.symbol)).label,
  };
}

/** Runs the chatbot's tool calls against the page. Reads state through a ref, so later steps see earlier ones. */
export function useChatTools(deps: Deps) {
  const ref = useRef(deps);
  ref.current = deps;
  // Changes made by this conversation that React hasn't rendered yet. Any render after an
  // update already includes it, so each render starts clean.
  const pending = useRef<Partial<ChatPrefs>>({});
  pending.current = {};
  const current = (): ChatPrefs => ({ ...ref.current.prefs, ...pending.current });
  const apply = (patch: Partial<ChatPrefs> & { frames?: Frame[]; pulseMarket?: MarketId }) => {
    const { frames: _f, pulseMarket: _m, ...rest } = patch;
    pending.current = { ...pending.current, ...rest };
    ref.current.update(patch);
  };

  const symbols = async (): Promise<SymbolEntry[]> => loadSymbols();
  const resolve = async (q: unknown) => {
    const e = resolveTicker(await symbols(), q);
    if (!e) throw new Error(`Couldn't find a stock or index matching “${String(q)}”. Try the ticker, e.g. RELIANCE or AAPL.`);
    return e;
  };

  const execute = useCallback(async (call: FunctionCall): Promise<ToolOutcome> => {
    const a = call.args ?? {};
    const p = current();
    switch (call.name) {
      case 'show_chart': {
        const e = await resolve(a.ticker);
        const askedP = toPeriod(a.period);
        const askedI = toInterval(a.interval);
        const fit = fitRange(askedP ?? p.period, askedI ?? p.interval, !!askedI && !askedP);
        ref.current.selectSymbol(e.symbol);
        apply({ symbol: e.symbol, period: fit.period, interval: fit.interval, view: 'chart', layout: 'single' });
        return {
          result: { ok: true, symbol: e.symbol, name: e.name, exchange: e.exchange, period: fit.period, interval: fit.interval, ...(fit.adjusted ? { note: fit.adjusted } : {}) },
          note: `Opened ${short(e.symbol)} · ${periodLabel(fit.period)} · ${intervalLabel(fit.interval)}`,
        };
      }
      case 'add_overlay':
      case 'remove_overlay': {
        const id = toOverlay(a.type);
        if (!id) return { result: { error: `Unknown overlay “${String(a.type)}”.` } };
        const label = OVERLAY_BY_ID.get(id)!.label;
        const has = p.overlays.includes(id);
        if (call.name === 'add_overlay') {
          if (!has) apply({ overlays: [...p.overlays, id], view: 'chart' });
          const intradayOnly = OVERLAY_BY_ID.get(id)!.intradayOnly && ['1d', '1wk', '1mo'].includes(p.interval);
          return { result: { ok: true, overlay: id, label, ...(intradayOnly ? { note: `${label} only shows on intraday candles; switch to an interval like 5m.` } : {}) }, note: `Added ${label}` };
        }
        if (has) apply({ overlays: p.overlays.filter((o) => o !== id) });
        return { result: { ok: true, removed: id }, note: has ? `Removed ${label}` : undefined };
      }
      case 'compare': {
        const list = Array.isArray(a.tickers) ? a.tickers : [];
        const found: string[] = [];
        const missing: string[] = [];
        for (const t of list.slice(0, ref.current.maxCompare)) {
          const e = resolveTicker(await symbols(), t);
          if (e && e.symbol !== p.symbol && !found.includes(e.symbol)) found.push(e.symbol);
          else if (!e) missing.push(String(t));
        }
        apply({ compare: found, view: 'chart', layout: 'single' });
        return {
          result: { ok: true, base: p.symbol, comparing: found, ...(missing.length ? { notFound: missing } : {}), ...(list.length > ref.current.maxCompare ? { note: `Only ${ref.current.maxCompare} can be compared at once.` } : {}) },
          note: found.length ? `Comparing ${short(p.symbol)} with ${found.map(short).join(', ')}` : 'Cleared comparison',
        };
      }
      case 'set_multi_timeframe': {
        const e = await resolve(a.ticker);
        const asked = (Array.isArray(a.intervals) ? a.intervals : []).map(toInterval).filter((i): i is IntervalId => !!i);
        const defaults: IntervalId[] = ['15m', '60m', '1d'];
        const intervals = [...asked, ...defaults.filter((d) => !asked.includes(d))].slice(0, 3);
        const frames: Frame[] = intervals.map((i) => ({ interval: i, period: periodFor(i) }));
        ref.current.selectSymbol(e.symbol);
        apply({ symbol: e.symbol, layout: 'multi', view: 'chart', frames });
        return { result: { ok: true, symbol: e.symbol, frames }, note: `Multi-timeframe ${short(e.symbol)}: ${intervals.map(intervalLabel).join(', ')}` };
      }
      case 'get_quote': {
        const e = await resolve(a.ticker);
        const r = await fetchQuotes([e.symbol]);
        const q = r.quotes?.[0];
        if (!q) return { result: { error: `No quote available for ${e.symbol}.` } };
        return { result: quoteFacts(q) };
      }
      case 'get_chart_summary': {
        const sym = a.ticker ? (await resolve(a.ticker)).symbol : p.symbol;
        const r = await fetchChart(sym, p.period, p.interval);
        const c = r.candles;
        if (!c.length) return { result: { error: 'No candles in this period.' } };
        const first = c[0].o;
        const last = c[c.length - 1].c;
        return {
          result: {
            ...quoteFacts(r.quote),
            period: p.period,
            interval: p.interval,
            candles: c.length,
            periodHigh: Math.max(...c.map((x) => x.h)),
            periodLow: Math.min(...c.map((x) => x.l)),
            periodReturnPct: Math.round(((last - first) / first) * 10000) / 100,
            signals: summarize(c, p.interval, r.quote.high52).map((s) => `${s.text} (${s.tone})`),
            overlaysOnScreen: p.overlays.map((o) => OVERLAY_BY_ID.get(o)?.label ?? o),
          },
        };
      }
      case 'open_markets': {
        const m: MarketId = a.market === 'IN' ? 'IN' : 'US';
        apply({ view: 'markets', pulseMarket: m });
        return { result: { ok: true, market: m }, note: `Opened ${m === 'IN' ? 'India' : 'US'} markets` };
      }
      case 'add_to_watchlist': {
        const e = await resolve(a.ticker);
        const wl = ref.current.watchlist;
        if (!wl.symbols.includes(e.symbol)) wl.toggle(e.symbol);
        return { result: { ok: true, symbol: e.symbol, watchlist: wl.name }, note: `Added ${short(e.symbol)} to “${wl.name}”` };
      }
      default:
        return { result: { error: `Unknown tool ${call.name}.` } };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const system = useCallback((): string => {
    const p = current();
    const ctx: ChatContext = {
      now: new Date(),
      view: p.view,
      symbol: p.symbol,
      name: ref.current.name,
      period: p.period,
      interval: p.interval,
      overlays: p.overlays,
      compare: p.compare,
      layout: p.layout,
      marketState: { IN: marketStatus('IN').label, US: marketStatus('US').label },
    };
    return systemPrompt(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { execute, system };
}
