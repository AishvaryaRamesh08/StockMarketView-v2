import { useMemo, useState } from 'react';
import { useNow } from '../hooks/useNow.ts';
import { useNews, usePatternFeed, usePulse } from '../hooks/useMarketData.ts';
import { formatAgo, formatPct, formatPrice } from '../lib/format.ts';
import type { PulseStock } from '../lib/marketData.ts';
import type { PatternId } from '../lib/patterns.ts';
import { breadth, topMovers } from '../lib/pulse.ts';
import type { MarketId } from '../lib/types.ts';
import { buildMatchers, matchStocks } from '../lib/newsMatch.ts';
import { InfoTip } from './InfoTip.tsx';
import { MarketStatusPill } from './MarketStatusPills.tsx';
import { PatternsFeed } from './PatternsFeed.tsx';
import { Sparkline } from './Sparkline.tsx';

interface Props {
  market: MarketId;
  onMarket: (m: MarketId) => void;
  onOpen: (symbol: string, pattern?: PatternId) => void;
}

/** The landing page: how the whole market is doing right now, before you search for anything. */
export function MarketPulse({ market, onMarket, onOpen }: Props) {
  const { pulse, error, lastUpdated } = usePulse(market, true);
  const { feed, error: feedError } = usePatternFeed(market, true);
  const { news, error: newsError, lastUpdated: newsUpdated } = useNews(market, true);
  const now = useNow(1000);
  const currency = market === 'IN' ? 'INR' : 'USD';
  const index = market === 'IN' ? 'NIFTY 500' : 'S&P 500';

  const stocks = pulse?.stocks ?? [];
  const movers = useMemo(() => topMovers(stocks, 10), [stocks]);
  const bySymbol = useMemo(() => new Map(stocks.map((s) => [s.s, s])), [stocks]);
  const matchers = useMemo(() => buildMatchers(stocks), [stocks]);
  const [allNews, setAllNews] = useState(false);
  const sources = [...new Set((news?.items ?? []).map((i) => i.source))];
  const b = useMemo(() => breadth(stocks), [stocks]);
  const total = b.up + b.down + b.flat || 1;

  const moverRow = (s: PulseStock) => (
    <li key={s.s}>
      <button className="mover-row" onClick={() => onOpen(s.s)}>
        <span className="mover-name">
          <b>{s.s.replace(/\.(NS|BO)$/, '')}</b>
          <span>{s.n}</span>
        </span>
        <span className="num mover-price">{formatPrice(s.p, currency, 2, false)}</span>
        <span className={`num chg-pill ${s.chg >= 0 ? 'up' : 'down'}`}>{formatPct(s.chg)}</span>
      </button>
    </li>
  );

  return (
    <div className="pulse">
      <header className="pulse-head">
        <div className="pulse-title">
          <h1>Markets</h1>
          <div className="segmented text" role="radiogroup" aria-label="Market">
            {(['IN', 'US'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={market === m} className={market === m ? 'active' : ''} onClick={() => onMarket(m)}>
                {m === 'IN' ? 'India' : 'US'}
              </button>
            ))}
          </div>
          <MarketStatusPill market={market} />
        </div>
        {stocks.length === 0 && (
          // Same size as the real line, so the page doesn't jump when the data arrives.
          <div className="breadth" aria-hidden style={{ visibility: 'hidden' }}>
            <span className="breadth-label">
              <b>0 up</b> · <b>0 down</b>
            </span>
            <span className="breadth-bar" />
          </div>
        )}
        {stocks.length > 0 && (
          <div className="breadth">
            <InfoTip text={`Market breadth: how many ${index} stocks are up versus down today. A rising index with most stocks falling is a narrow, fragile rally.`}>
              <span className="breadth-label" tabIndex={0}>
                <b className="up">{b.up} up</b> · <b className="down">{b.down} down</b>
                {b.flat > 0 && <> · {b.flat} flat</>}
              </span>
            </InfoTip>
            <span className="breadth-bar" aria-hidden>
              <span className="up-part" style={{ width: `${(b.up / total) * 100}%` }} />
              <span className="down-part" style={{ width: `${(b.down / total) * 100}%` }} />
            </span>
            {lastUpdated && <span className="updated">updated {formatAgo(now - lastUpdated)}</span>}
          </div>
        )}
      </header>

      {error && !pulse && <div className="banner-error">Market data didn't load: {error}</div>}

      <div className="index-cards">
        {(pulse?.indices ?? []).map((q) => (
          <button key={q.symbol} className="index-card" onClick={() => onOpen(q.symbol)}>
            <span className="ic-name">{q.name}</span>
            <span className="ic-price num">{formatPrice(q.price, q.currency, 2, false)}</span>
            <span className={`ic-chg num ${(q.change ?? 0) >= 0 ? 'up' : 'down'}`}>
              {formatPct(q.changePct)}
            </span>
            <Sparkline values={q.spark} prevClose={q.prevClose} width={120} height={34} />
          </button>
        ))}
        {!pulse && Array.from({ length: 4 }, (_, i) => <div key={i} className="index-card skeleton" />)}
      </div>

      <div className="pulse-grid">
        <div className="pulse-main">
          <div className="movers-pair">
            {(['gainers', 'losers'] as const).map((k) => (
              <section key={k} className="card movers" aria-labelledby={`mv-${k}`}>
                <div className="card-head">
                  <h2 id={`mv-${k}`}>{k === 'gainers' ? 'Top gainers' : 'Top losers'}</h2>
                  <span className="card-sub">{index} · today</span>
                </div>
                <ul className="mover-list">{stocks.length ? movers[k].map(moverRow) : Array.from({ length: 10 }, (_, i) => <li key={i} className="skeleton" style={{ height: 42, margin: '3px 0' }} />)}</ul>
              </section>
            ))}
          </div>
          <PatternsFeed feed={feed} error={feedError} currency={currency} onOpen={(s, p) => onOpen(s, p)} />
        </div>

        <aside className="card news" aria-labelledby="news-title">
          <div className="card-head">
            <div>
              <h2 id="news-title">Market news</h2>
              <p className="card-sub">
                {sources.length ? `From ${sources.join(' and ')}` : 'Latest headlines'}
                {newsUpdated ? ` · updated ${formatAgo(now - newsUpdated)}, refreshes hourly` : ''}
              </p>
            </div>
          </div>
          {newsError && !news && <p className="empty-note">News didn't load: {newsError}</p>}
          <ul className="news-list">
            {news
              ? news.items.slice(0, allNews ? undefined : 8).map((item) => {
                  const related = matchStocks(`${item.title} ${item.summary}`, matchers);
                  return (
                    <li key={item.link} className="news-item">
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className="news-title">
                        {item.title}
                        <svg viewBox="0 0 12 12" aria-hidden>
                          <path d="M4.5 2.5h5v5M9.5 2.5 3 9" />
                        </svg>
                      </a>
                      {item.summary && <p className="news-summary">{item.summary}</p>}
                      <div className="news-meta">
                        <span>
                          {item.source} · {formatAgo(now - item.time * 1000)}
                        </span>
                        {related.map((sym) => {
                          const st = bySymbol.get(sym)!;
                          return (
                            <button key={sym} className={`news-chip ${st.chg >= 0 ? 'up' : 'down'}`} onClick={() => onOpen(sym)} title={`${st.n}: open chart`}>
                              {sym.replace(/\.(NS|BO)$/, '')} <span className="num">{formatPct(st.chg)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })
              : !newsError && Array.from({ length: 8 }, (_, i) => <li key={i} className="skeleton" style={{ height: 111, margin: '8px 0' }} />)}
          </ul>
          {news && news.items.length > 8 && (
            <button className="link news-more" onClick={() => setAllNews((v) => !v)}>
              {allNews ? 'Show fewer' : `Show ${news.items.length - 8} more headlines`}
            </button>
          )}
          <p className="news-foot">Headlines open on the publisher's site. News is for context, not advice.</p>
        </aside>
      </div>
    </div>
  );
}
