# StockMarketView v2

Free live stock charts for India (NSE, BSE) and the US (NYSE, NASDAQ). No sign-up, no ads, no paywall.

**Live site: https://stockmarketview.aishvaryaramesh.workers.dev**

This is a rebuild of [StockMarketView v1](https://github.com/AishvaryaRamesh08/StockMarketView) (2021, Python Dash + Plotly + TA-Lib),
which I wrote by hand during my undergrad degree. v2 is being built with AI-assisted development; a v1-vs-v2 comparison will be
added when the build is complete.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Data proxy, ticker search (India + US), live chart with period/interval chips, market status, deploy pipeline | **Done** |
| 2 | Indicators, candlestick patterns, plain-English summary, tooltips, key levels, fundamentals, compare, multi-timeframe, watchlists | **Done** |
| 3 | Market pulse landing page, scheduled data job, "patterns today" feed, similar stocks | **Done** |
| 4 | Drawing tools, PNG export, shareable URLs | **Done** |
| 5 | Paper trading | **Done** |
| 6 | Gemini chatbot (bring your own key), text then voice | **Done** |
| 7 | Visual polish, mobile and performance passes, v1-vs-v2 write-up | Next |

## Features so far

- **Live charts** for NSE, BSE, NYSE and NASDAQ stocks and indices, refreshed every 30 seconds while the market is open.
- **Indicators** (unlimited): SMA 20/50/100/200, EMA 9/21, Bollinger Bands, Ichimoku, Parabolic SAR, VWAP, plus RSI and MACD in their own panels.
- **Candlestick patterns** marked on the chart: engulfing, hammer, shooting star, doji, morning/evening star, harami.
- **At a glance**: a plain-English summary of trend, RSI, MACD crossovers and recent patterns. Rule-based, no API key.
- **Hover explanations** for every indicator, pattern and stat, written for beginners.
- **Key levels**: 52-week high/low, previous day high/low, automatic support and resistance.
- **Fundamentals**: market cap, P/E, sector and industry; dividends and splits marked on the chart.
- **Compare** up to 4 stocks or indices as % change.
- **Multi-timeframe**: three charts of the same stock with synced crosshairs.
- **Watchlists**: multiple named lists with live prices, sparklines and pattern badges.
- **Markets page** (the landing page): India/US toggle, index cards, market breadth, and the NIFTY 500 / S&P 500
  top gainers and losers, refreshed every 2 minutes while the market is open.
- **Market news**: the latest headlines beside the movers, each with a short snippet and a link to the full
  article on the publisher's site (nothing is copied or stored). India: The Economic Times and Mint; US: Yahoo
  Finance. Headlines that name an index stock show it with today's move ("NVDA −0.96%"), one click from its chart.
  Fetched from the publishers' RSS feeds at most once an hour per Cloudflare location.
- **Patterns today**: every NIFTY 500 and S&P 500 stock scanned for candlestick patterns after each close,
  ranked by unusual volume, with RSI; one click opens the chart with the pattern marked.
- **Similar stocks**: same-industry peers below the chart, with one-click compare.
- **Drawing tools**: trendline, horizontal level, rectangle, Fibonacci retracement and text notes. Select, drag to
  move, undo/redo (Cmd/Ctrl+Z), Delete to remove. Drawings are anchored to price and time, so they stay put when
  you change period or interval, and are saved per stock in this browser.
- **Image export**: download or copy the chart as a PNG with a caption (stock, timeframe, date) and no watermark.
- **Shareable links**: the address bar always describes the chart on screen (stock, period, interval, indicators,
  compare, layout), and Share copies it. Drawings are not part of links; share them as an image.
- **Paper trading**: virtual INR and USD wallets (₹10,00,000 and $100,000 by default), market, limit and stop
  orders, long-only and whole shares. Market orders placed while a market is closed fill at the first price after
  the open. Fills, working orders and average cost are drawn on the chart. A Portfolio page shows account value,
  cash, holdings, realised and unrealised P&L, an equity curve and full order history, with JSON export/import and
  reset. Orders are only checked while the site is open in a tab; fills ignore slippage, fees, dividends and splits.
- **Ask AI** (Gemini, bring your own key): type or say “show Reliance for a year with RSI”, “compare TCS with
  Infosys” or “what is a demat account?”. It drives the site through function calling (open charts, add or remove
  indicators, compare, multi-timeframe, quotes, chart summaries, Markets page, watchlist) and answers beginner
  questions carried over from the v1 Rasa bot. It never gives buy/sell recommendations and cannot place trades.
  The key is stored only in the visitor's browser and sent only to Google (in a request header, never a URL); it
  never reaches this site's Worker. The model is a setting (default `gemini-3.5-flash-lite`, the fastest); if it is overloaded, slow or out of
  quota the chat falls back to another Gemini model and says so. Voice input uses the
  browser's built-in speech recognition and is hidden where the browser lacks it.
- **Welcome guide**: a short first-visit introduction to the three pages and main features, reopened from **?**.
- **Maximize** (F): only the top bar, chart controls and chart.
- **Appearance**: dark and light themes, plus a colour-blind-friendly blue/orange palette for up/down.
- **Command palette** (Cmd/Ctrl+K): search stocks, or type a command such as "light theme", "show RSI" or "go to markets".
- **Remembers your setup**: last view, stock, timeframe, indicators, layout and appearance.

Upcoming earnings dates are not shown: Yahoo only serves them to logged-in sessions.

## How it works

```
Browser (React + Lightweight Charts)
   │  full history once, then the latest candles every 30s
   ▼
/api/*  Cloudflare Worker (worker/index.ts → server/api.ts)
   │  edge cache: 20s for live ranges, 5 min for long history
   ▼
Yahoo Finance chart + spark endpoints
```

- **One upstream call per ticker per 20 seconds**, however many people are watching it, thanks to the edge cache.
- **Incremental refresh:** the chart downloads full history once, then polls a short range (1 day for intraday, 5 days for daily)
  and updates only the last candles in place. v1 re-downloaded everything every 30 seconds.
- **Batched quotes:** the index strip and the current stock's day change come from one `/api/quotes` request.
- **Polls only when useful:** every 30s while the stock's market is open, every 5 minutes when closed, and not at all while the tab is hidden.
- **Search index** (`public/symbols.json`, 18.8k symbols, about 240 KB gzipped) loads only when search is first opened.
- **No accounts or database.** Preferences are kept in the visitor's browser.
- **Market-wide data**: `/api/pulse` prices all ~500 stocks of a market in 25 batched calls, cached for 2 minutes.
  Work that needs one request per stock runs in GitHub Actions instead (`.github/workflows/market-data.yml`):
  the pattern scan after each close and the constituent list weekly. Results are published as assets of the
  `data` release, which the API reads and caches.
- **News**: `/api/news` reads the publishers' RSS feeds and caches the headlines for an hour, so each visitor costs one
  request an hour for news. The movers snapshot is cached for 2 minutes and polled every 2 minutes.

Prices are labelled "refreshed every 30s", never "real-time": Yahoo's feed is unofficial and some listings are exchange-delayed.

## Project layout

```
server/api.ts             Data API: routes, validation, edge caching
server/yahoo.ts           Everything Yahoo-specific (URLs, response shapes, quirk fixes), shared with scripts/
worker/index.ts           Cloudflare Worker entry: /api/* to the data API, everything else to dist/
src/lib/                  Indicators, patterns, key levels, summary, market hours, period/interval rules,
                          candle merging, search, formatting (all with tests)
src/data/holidays.ts      NSE/BSE and NYSE/NASDAQ holiday calendars; update yearly
src/hooks/                Live chart, batched quotes, visibility-aware polling
src/components/           Chart, quote header, chips, market status, index strip, search palette
scripts/build-symbols.mjs Rebuilds the search index from NSE's and NASDAQ Trader's official lists
```

## Running locally

```bash
npm install
npm run dev      # http://localhost:5173, /api is served by the same handler as production
npm test
npm run build
```

Refresh the ticker list (NSE official list + v1's BSE list + NASDAQ Trader directories) with `npm run symbols`.

Build the market data locally with `npm run data:universe` then `npm run data:patterns` (files go to `data-out/`,
which the dev server uses before falling back to the published release).

## Deploying (free)

The site runs as one **Cloudflare Worker** on the free plan: static files in `dist/` are served by
Cloudflare's asset hosting (free, unmetered) and only `/api/*` runs the Worker (100,000 requests per day).
Cloudflare rebuilds and redeploys on every push to `main`.

One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository**, and pick this repository.
2. Project name `stockmarketview` (must match `name` in `wrangler.toml`), build command `npm run build`,
   deploy command `npx wrangler deploy`.
3. Deploy. The site goes live at `https://stockmarketview.<your-subdomain>.workers.dev`.

`wrangler.toml` configures the Worker (`worker/index.ts`) and asset serving; `.node-version` pins Node 22 for the build.
GitHub Actions (`.github/workflows/ci.yml`) runs the tests on every push.

To run the production Worker locally: `npm run build && npx wrangler dev`.

## Keeping data accurate

- Update `src/data/holidays.ts` each year when NSE and NYSE publish their calendars. India's 2027 dates are marked provisional.
- NSE's Diwali Muhurat session is not modelled yet.
- Yahoo sends the current day's daily candle empty for NSE/BSE stocks; the API and the scan rebuild it from 5-minute bars.

## Disclaimer

Data may be delayed and comes from an unofficial source. Nothing on this site is investment advice.
