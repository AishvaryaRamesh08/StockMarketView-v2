import { useMemo, useState } from 'react';
import { useNow } from '../hooks/useNow.ts';
import { usePatternFeed, usePulse } from '../hooks/useMarketData.ts';
import { formatAgo, formatPct, formatPrice, formatVolume } from '../lib/format.ts';
import type { PulseStock } from '../lib/marketData.ts';
import type { PatternId } from '../lib/patterns.ts';
import { breadth, topMovers } from '../lib/pulse.ts';
import type { MarketId } from '../lib/types.ts';
import { Heatmap } from './Heatmap.tsx';
import { InfoTip } from './InfoTip.tsx';
import { MarketStatusPill } from './MarketStatusPills.tsx';
import { PatternsFeed } from './PatternsFeed.tsx';
import { Sparkline } from './Sparkline.tsx';

interface Props {
  market: MarketId;
  onMarket: (m: MarketId) => void;
  onOpen: (symbol: string, pattern?: PatternId) => void;
}

type MoverTab = 'gainers' | 'losers' | 'active';
const TAB_LABEL: Record<MoverTab, string> = { gainers: 'Top gainers', losers: 'Top losers', active: 'Most active' };

/** The landing page: how the whole market is doing right now, before you search for anything. */
export function MarketPulse({ market, onMarket, onOpen }: Props) {
  const { pulse, error, lastUpdated } = usePulse(market, true);
  const { feed, error: feedError } = usePatternFeed(market, true);
  const [tab, setTab] = useState<MoverTab>('gainers');
  const now = useNow(1000);
  const currency = market === 'IN' ? 'INR' : 'USD';
  const index = market === 'IN' ? 'NIFTY 500' : 'S&P 500';

  const stocks = pulse?.stocks ?? [];
  const movers = useMemo(() => topMovers(stocks), [stocks]);
  const b = useMemo(() => breadth(stocks), [stocks]);
  const total = b.up + b.down + b.flat || 1;

  const moverRow = (s: PulseStock) => (
    <li key={s.s}>
      <button className="mover-row" onClick={() => onOpen(s.s)}>
        <span className="mover-name">
          <b>{s.s.replace(/\.(NS|BO)$/, '')}</b>
          <span>{s.n}</span>
        </span>
        <span className="num mover-price">{tab === 'active' ? formatVolume(s.t, currency) : formatPrice(s.p, currency, 2, false)}</span>
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
        {!pulse && Array.from({ length: 4 }, (_, i) => <div key={i} className="index-card skeleton" style={{ height: 96 }} />)}
      </div>

      <div className="pulse-grid">
        <section className="card heatmap-card" aria-labelledby="hm-title">
          <div className="card-head">
            <div>
              <h2 id="hm-title">{index} heatmap</h2>
              <p className="card-sub">Size is market cap, colour is today's change. Click a stock to open its chart.</p>
            </div>
            <div className="hm-legend" aria-hidden>
              <span>−3%</span>
              <span className="hm-scale" />
              <span>+3%</span>
            </div>
          </div>
          <Heatmap stocks={stocks} currency={currency} onOpen={onOpen} />
        </section>

        <section className="card movers" aria-label="Market movers">
          <div className="tabs" role="tablist">
            {(Object.keys(TAB_LABEL) as MoverTab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {tab === 'active' && <p className="card-sub tab-note">Ranked by value traded today (price × volume).</p>}
          <ul className="mover-list">{stocks.length ? movers[tab].map(moverRow) : Array.from({ length: 8 }, (_, i) => <li key={i} className="skeleton" style={{ height: 38, margin: '4px 0' }} />)}</ul>
        </section>
      </div>

      <PatternsFeed feed={feed} error={feedError} currency={currency} onOpen={(s, p) => onOpen(s, p)} />
    </div>
  );
}
