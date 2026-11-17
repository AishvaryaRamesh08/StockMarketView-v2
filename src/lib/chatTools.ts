/**
 * The chatbot's tools (Gemini function declarations), the argument clean-up they need, and the
 * system prompt. Pure functions so they can be unit-tested; App.tsx wires them to the UI.
 */
import type { FunctionDeclaration } from './gemini.ts';
import { INTERVALS, isIntervalId, isPeriodId, PERIODS, periodForInterval, unsupportedReason, type IntervalId, type PeriodId } from './ranges.ts';
import { OVERLAYS, type OverlayId } from './overlays.ts';
import { searchSymbols, type SymbolEntry } from './search.ts';
import type { MarketId } from './types.ts';

const PERIOD_IDS = PERIODS.map((p) => p.id);
const INTERVAL_IDS = INTERVALS.map((i) => i.id);
const OVERLAY_IDS = OVERLAYS.map((o) => o.id);

const TICKER = { type: 'string', description: 'Company name or ticker, e.g. "Reliance", "TCS", "AAPL", "Apple", "NIFTY 50". Indian stocks resolve to NSE.' };

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'show_chart',
    description: 'Open the price chart of a stock or index on the site. Period and interval are optional; leave them out to keep the current ones.',
    parameters: {
      type: 'object',
      properties: {
        ticker: TICKER,
        period: { type: 'string', enum: PERIOD_IDS, description: 'Time span shown: 1d, 5d, 1mo, 3mo, 6mo, ytd, 1y, 5y, 10y, max.' },
        interval: { type: 'string', enum: INTERVAL_IDS, description: 'Candle size: 1m, 2m, 5m, 15m, 30m, 60m (hourly), 1d (daily), 1wk (weekly), 1mo (monthly).' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'add_overlay',
    description: 'Add an indicator, candlestick pattern marker, key level or event marker to the chart.',
    parameters: { type: 'object', properties: { type: { type: 'string', enum: OVERLAY_IDS, description: overlayHelp() } }, required: ['type'] },
  },
  {
    name: 'remove_overlay',
    description: 'Remove an indicator or marker from the chart.',
    parameters: { type: 'object', properties: { type: { type: 'string', enum: OVERLAY_IDS } }, required: ['type'] },
  },
  {
    name: 'compare',
    description: 'Overlay up to 4 other stocks or indices on the current chart as % change, to compare performance. An empty list clears the comparison.',
    parameters: { type: 'object', properties: { tickers: { type: 'array', items: TICKER, description: 'Up to 4 tickers or company names.' } }, required: ['tickers'] },
  },
  {
    name: 'set_multi_timeframe',
    description: 'Show one stock as three charts side by side, each with its own candle interval (e.g. 15m, 60m, 1d).',
    parameters: {
      type: 'object',
      properties: { ticker: TICKER, intervals: { type: 'array', items: { type: 'string', enum: INTERVAL_IDS }, description: 'Exactly 3 intervals, shortest first.' } },
      required: ['ticker', 'intervals'],
    },
  },
  {
    name: 'get_quote',
    description: "Get a stock's latest price, today's change, day range, volume and 52-week range.",
    parameters: { type: 'object', properties: { ticker: TICKER }, required: ['ticker'] },
  },
  {
    name: 'get_chart_summary',
    description: 'Read the chart currently on screen (or of a given ticker): trend vs moving averages, RSI, MACD, recent candlestick patterns, and the high, low and return over the period. Use it before explaining a chart.',
    parameters: { type: 'object', properties: { ticker: { ...TICKER, description: 'Optional; defaults to the stock on screen.' } } },
  },
  {
    name: 'open_markets',
    description: "Open the Markets overview page (indices, top gainers and losers, latest market news, today's patterns) for India or the US.",
    parameters: { type: 'object', properties: { market: { type: 'string', enum: ['IN', 'US'] } }, required: ['market'] },
  },
  {
    name: 'add_to_watchlist',
    description: "Add a stock to the visitor's current watchlist.",
    parameters: { type: 'object', properties: { ticker: TICKER }, required: ['ticker'] },
  },
];

function overlayHelp(): string {
  return OVERLAYS.map((o) => `${o.id} = ${o.label}`).join('; ');
}

// ------------------------------------------------------------------ argument clean-up

const PERIOD_ALIASES: Record<string, PeriodId> = { '1w': '5d', '1wk': '5d', week: '5d', '1m': '1mo', month: '1mo', '3m': '3mo', '6m': '6mo', year: '1y', '1yr': '1y', '5yr': '5y', all: 'max' };
const INTERVAL_ALIASES: Record<string, IntervalId> = { '1h': '60m', hour: '60m', hourly: '60m', '60min': '60m', d: '1d', day: '1d', daily: '1d', w: '1wk', '1w': '1wk', week: '1wk', weekly: '1wk', monthly: '1mo', month: '1mo' };

export function toPeriod(v: unknown): PeriodId | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (isPeriodId(s)) return s;
  return PERIOD_ALIASES[s] ?? null;
}

export function toInterval(v: unknown): IntervalId | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (isIntervalId(s)) return s;
  return INTERVAL_ALIASES[s] ?? null;
}

/** Accepts an id ("rsi"), a label ("Bollinger Bands") or a close variant ("bollinger", "SMA50"). */
export function toOverlay(v: unknown): OverlayId | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/[\s_\-]/g, '');
  if (!s) return null;
  for (const o of OVERLAYS) if (o.id.toLowerCase() === s || o.label.toLowerCase().replace(/[\s_\-()/,]/g, '') === s) return o.id;
  for (const o of OVERLAYS) if (o.label.toLowerCase().replace(/[\s_\-()/,]/g, '').startsWith(s) || s.startsWith(o.id.toLowerCase())) return o.id;
  return null;
}

/**
 * Picks a period/interval pair the data source can serve, starting from what was asked.
 * Returns a note when something had to change.
 */
export function fitRange(period: PeriodId, interval: IntervalId, keepInterval: boolean): { period: PeriodId; interval: IntervalId; adjusted?: string } {
  if (!unsupportedReason(period, interval)) return { period, interval };
  if (keepInterval) {
    const p = periodForInterval(interval, period);
    return { period: p, interval, adjusted: `${unsupportedReason(period, interval)}, so the period was changed to ${p}.` };
  }
  const i = defaultFor(period);
  return { period, interval: i, adjusted: `${unsupportedReason(period, interval)}, so the interval was changed to ${i}.` };
}

function defaultFor(period: PeriodId): IntervalId {
  return ({ '1d': '5m', '5d': '15m', '1mo': '60m', '3mo': '1d', '6mo': '1d', ytd: '1d', '1y': '1d', '5y': '1wk', '10y': '1wk', max: '1mo' } as const)[period];
}

/** A sensible period for a chart with the given candle size, used for multi-timeframe frames. */
export function periodFor(interval: IntervalId): PeriodId {
  return ({ '1m': '1d', '2m': '5d', '5m': '5d', '15m': '5d', '30m': '1mo', '60m': '1mo', '1d': '1y', '1wk': '5y', '1mo': 'max' } as const)[interval];
}

const INDEX_NAMES: Record<string, string> = {
  nifty: '^NSEI',
  'nifty 50': '^NSEI',
  nifty50: '^NSEI',
  sensex: '^BSESN',
  'bank nifty': '^NSEBANK',
  banknifty: '^NSEBANK',
  'nifty bank': '^NSEBANK',
  's&p 500': '^GSPC',
  'sp 500': '^GSPC',
  sp500: '^GSPC',
  's&p': '^GSPC',
  nasdaq: '^IXIC',
  'nasdaq composite': '^IXIC',
  dow: '^DJI',
  'dow jones': '^DJI',
};

/** Resolves a name or ticker to a symbol on the site's list; NSE wins over BSE for Indian names. */
export function resolveTicker(entries: SymbolEntry[], query: unknown): SymbolEntry | null {
  if (typeof query !== 'string') return null;
  const q = query.trim();
  if (!q) return null;
  const idx = INDEX_NAMES[q.toLowerCase()];
  if (idx) return entries.find((e) => e.symbol === idx) ?? null;
  const exact = entries.find((e) => e.symbol.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  return searchSymbols(entries, q.replace(/\.(NS|BO)$/i, ''), 'ALL', 1)[0] ?? null;
}

// ------------------------------------------------------------------ system prompt

export interface ChatContext {
  now: Date;
  view: 'markets' | 'chart' | 'portfolio';
  symbol: string;
  name?: string;
  period: PeriodId;
  interval: IntervalId;
  overlays: OverlayId[];
  compare: string[];
  layout: 'single' | 'multi';
  marketState: Record<MarketId, string>;
}

/** FAQ topics carried over from the v1 Rasa bot, rewritten as background knowledge. */
const FAQ = `Background for beginner questions (from this project's earlier Rasa chatbot; explain in your own words, keep it general and educational):
- A stock (share) is a unit of ownership in a company and a claim on part of its assets and profits. Companies list shares on an exchange to raise money; investors then buy and sell them there.
- India has two main exchanges, BSE (Bombay Stock Exchange, founded 1875, index: SENSEX) and NSE (National Stock Exchange, index: NIFTY 50). Most large companies list on both; prices are nearly identical; NSE has more trading volume.
- To trade in India you need a demat account (holds shares electronically, through the depositories NSDL and CDSL) and a trading account (places orders), both opened through a SEBI-registered broker. Opening one usually needs PAN, Aadhaar/address proof, a bank account and an in-person or video KYC.
- Getting started: learn the basics, open the accounts, start small, prefer liquid large companies, diversify across sectors rather than holding a single stock, and practise first, for example with this site's paper trading.
- Things beginners are often warned about: illiquid small-caps and penny stocks, putting all money in one stock, and expecting steady returns; returns vary a lot from year to year.
- "Bottoming out" is when a falling price stops making new lows and starts to stabilise; it is only clear in hindsight.
- Good free learning resources: Investopedia, NSE/BSE investor education pages, SEBI's investor website, and the exchanges' and Yahoo Finance's data pages.`;

export function systemPrompt(c: ChatContext): string {
  const date = c.now.toISOString().slice(0, 10);
  return `You are the assistant inside StockMarketView, a free website with live charts of Indian (NSE, BSE) and US stocks. Today is ${date}.

What you do: turn the visitor's requests into charts using your tools, read charts back to them, and explain stock-market ideas in plain English for beginners. Be brief (a few sentences or a short list), friendly and concrete. Use the tools rather than describing how to click.

Hard rules:
- Never recommend buying, selling or holding any stock, never predict prices, and never give personal investment advice, even if asked directly or hypothetically. Instead explain what the chart or indicator shows and that the decision is theirs; suggest a licensed adviser for personal advice.
- You cannot place trades, including paper trades. If asked, explain that they can practise with virtual money using the Paper trade button on the chart.
- Only state prices and numbers that come from your tools in this conversation; do not invent data. Prices may be delayed.
- Answer only about markets, investing education and this website. Politely decline anything else.

How to use the tools:
- Map requests like "show Reliance for a year with RSI" to show_chart (ticker "Reliance", period "1y") then add_overlay ("rsi"). Do every step needed in one go.
- To compare stocks, first call show_chart for the main stock (the first one named) unless it is already on screen, then call compare with the others. Never compare from a different stock than the one asked about.
- Before explaining or describing a chart, call get_chart_summary; for a price, call get_quote.
- If a tool reports that a ticker wasn't found or a range was adjusted, tell the visitor briefly.
- After acting, say in one short sentence what you changed.

Website features you can mention: Markets page (indices, top gainers and losers, latest market news headlines with links, today's patterns), Chart page (indicators, candlestick patterns, key levels, drawing tools, image export, share links, compare, multi-timeframe), watchlists (star), paper trading with ₹10 lakh / $100,000 virtual money and a Portfolio page.

Current screen: ${c.view === 'chart' ? `chart of ${c.name ? `${c.name} (${c.symbol})` : c.symbol}, period ${c.period}, interval ${c.interval}, layout ${c.layout}` : `${c.view} page (last chart: ${c.symbol})`}. Overlays on: ${c.overlays.join(', ') || 'none'}.${c.compare.length ? ` Comparing with: ${c.compare.join(', ')}.` : ''} India market: ${c.marketState.IN}. US market: ${c.marketState.US}.

${FAQ}`;
}
