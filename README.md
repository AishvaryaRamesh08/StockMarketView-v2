# StockMarketView v2

Free live stock charts for India (NSE, BSE) and the US (NYSE, NASDAQ). No sign-up, no ads, no paywall.

This is a rebuild of [StockMarketView v1](https://github.com/AishvaryaRamesh08/StockMarketView) (2021, Python Dash + Plotly + TA-Lib),
which I wrote by hand during my undergrad degree. v2 is being built with AI-assisted development; a v1-vs-v2 comparison will be
added when the build is complete.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Data proxy, ticker search (India + US), live chart with period/interval chips, market status, deploy pipeline | **Done** |
| 2 | Indicators, candlestick patterns, plain-English summary, tooltips, key levels, fundamentals, compare, multi-timeframe, watchlists | Next |
| 3 | Market pulse landing page, scheduled data job, "patterns today" feed, similar stocks | |
| 4 | Drawing tools, PNG export, shareable URLs | |
| 5 | Paper trading | |
| 6 | Gemini chatbot (bring your own key), text then voice | |
| 7 | Visual polish, mobile and performance passes, v1-vs-v2 write-up | |

## How it works

```
Browser (React + Lightweight Charts)
   │  full history once, then the latest candles every 30s
   ▼
/api/*  Cloudflare Pages Function (functions/api/[[route]].ts → server/api.ts)
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
functions/api/[[route]].ts Cloudflare Pages Function entry
src/lib/                  Market hours, period/interval rules, candle merging, search, formatting (+ tests)
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

Cloudflare Pages hosts the site and the `/api` function on the free plan (100,000 function requests per day).

1. Create a free Cloudflare account, then **Workers & Pages → Create → Pages → Direct upload**, and name the project `stockmarketview`.
2. Create an API token with the **Cloudflare Pages: Edit** permission.
3. In the GitHub repository, add secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Push to `main`. The workflow runs the tests, builds, and deploys to `https://stockmarketview.pages.dev`.

Until the secrets are set, the workflow still tests and builds on every push and skips the deploy step.

## Keeping data accurate

- Update `src/data/holidays.ts` each year when NSE and NYSE publish their calendars. India's 2027 dates are marked provisional.
- NSE's Diwali Muhurat session is not modelled yet.

## Disclaimer

Data may be delayed and comes from an unofficial source. Nothing on this site is investment advice.
