# StockMarketView v2

Free live stock charts for India (NSE, BSE) and the US (NYSE, NASDAQ). No sign-up, no ads, no paywall.

**Live site: https://stockmarketview-v2.aishvaryaramesh.workers.dev**

This is a rebuild of [StockMarketView v1](https://github.com/AishvaryaRamesh08/StockMarketView) (2021, Python Dash + Plotly + TA-Lib),
which I wrote by hand during my undergrad degree. v2 is being built with AI-assisted development; a v1-vs-v2 comparison will be
added when the build is complete.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Data proxy, ticker search (India + US), live chart with period/interval chips, market status, deploy pipeline | **Done** |
| 2 | Indicators, candlestick patterns, plain-English summary, tooltips, key levels, fundamentals, compare, multi-timeframe, watchlists | **Done** |
| 3 | Market pulse landing page, scheduled data job, "patterns today" feed, similar stocks | Next |
| 4 | Drawing tools, PNG export, shareable URLs | |
| 5 | Paper trading | |
| 6 | Gemini chatbot (bring your own key), text then voice | |
| 7 | Visual polish, mobile and performance passes, v1-vs-v2 write-up | |

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
- **Remembers your setup**: last stock, timeframe, indicators and layout.

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

Prices are labelled "refreshed every 30s", never "real-time": Yahoo's feed is unofficial and some listings are exchange-delayed.

## Project layout

```
server/api.ts             Data API (Yahoo-specific code lives only here, so the provider can be swapped)
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

## Deploying (free)

The site runs as one **Cloudflare Worker** on the free plan: static files in `dist/` are served by
Cloudflare's asset hosting (free, unmetered) and only `/api/*` runs the Worker (100,000 requests per day).
Cloudflare rebuilds and redeploys on every push to `main`.

One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository**, and pick this repository.
2. Project name `stockmarketview-v2` (must match `name` in `wrangler.toml`), build command `npm run build`,
   deploy command `npx wrangler deploy`.
3. Deploy. The site goes live at `https://stockmarketview-v2.<your-subdomain>.workers.dev`.

`wrangler.toml` configures the Worker (`worker/index.ts`) and asset serving; `.node-version` pins Node 22 for the build.
GitHub Actions (`.github/workflows/ci.yml`) runs the tests on every push.

To run the production Worker locally: `npm run build && npx wrangler dev`.

## Keeping data accurate

- Update `src/data/holidays.ts` each year when NSE and NYSE publish their calendars. India's 2027 dates are marked provisional.
- NSE's Diwali Muhurat session is not modelled yet.

## Disclaimer

Data may be delayed and comes from an unofficial source. Nothing on this site is investment advice.
