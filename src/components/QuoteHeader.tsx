import { useEffect, useRef, useState } from 'react';
import { useNow } from '../hooks/useNow.ts';
import { digitsFor, formatAgo, formatChange, formatLocalTime, formatPct, formatPrice, formatVolume } from '../lib/format.ts';
import { marketOf, marketStatus } from '../lib/markets.ts';
import type { Quote } from '../lib/types.ts';
import { MarketStatusPill } from './MarketStatusPills.tsx';

interface Props {
  symbol: string;
  quote: Quote | null;
  loading: boolean;
  lastUpdated: number | null;
  refreshError: string | null;
}

/** Briefly flashes green/red when the price changes. */
function useFlash(price: number | null | undefined): '' | 'flash-up' | 'flash-down' {
  const prev = useRef(price);
  const [flash, setFlash] = useState<'' | 'flash-up' | 'flash-down'>('');
  useEffect(() => {
    if (price != null && prev.current != null && price !== prev.current) {
      setFlash(price > prev.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 900);
      prev.current = price;
      return () => clearTimeout(t);
    }
    prev.current = price;
  }, [price]);
  return flash;
}

function Freshness({ symbol, lastUpdated, refreshError, quote }: { symbol: string; lastUpdated: number | null; refreshError: string | null; quote: Quote | null }) {
  const now = useNow(1000);
  const status = marketStatus(marketOf(symbol), new Date(now));
  if (refreshError) {
    return (
      <span className="freshness state-error" title={refreshError}>
        <span className="status-dot" /> Connection problem, retrying
      </span>
    );
  }
  if (status.state !== 'open') {
    const last = quote?.marketTime ? formatLocalTime(new Date(quote.marketTime * 1000), true) : null;
    return (
      <span className="freshness state-closed">
        <span className="status-dot" /> Market closed{last ? ` · last trade ${last}` : ''}
      </span>
    );
  }
  const age = lastUpdated ? now - lastUpdated : 0;
  const stale = age > 75_000;
  return (
    <span className={`freshness ${stale ? 'state-stale' : 'state-live'}`} title="Prices refresh every 30 seconds and may be delayed by the exchange.">
      <span className="status-dot" /> Refreshed every 30s · updated {formatAgo(age)}
    </span>
  );
}

export function QuoteHeader({ symbol, quote, loading, lastUpdated, refreshError }: Props) {
  const flash = useFlash(quote?.price);
  const market = marketOf(symbol);

  if (loading && !quote) {
    return (
      <header className="quote-header">
        <div className="quote-title">
          <span className="skeleton skeleton-text" style={{ width: 220, height: 22 }} />
          <span className="skeleton skeleton-text" style={{ width: 140 }} />
        </div>
        <div className="quote-price-block">
          <span className="skeleton skeleton-text" style={{ width: 160, height: 34 }} />
        </div>
      </header>
    );
  }
  if (!quote) return null;

  const digits = digitsFor(quote.priceHint, quote.price);
  const dir = quote.change == null ? '' : quote.change >= 0 ? 'up' : 'down';
  const range52 =
    quote.high52 != null && quote.low52 != null && quote.price != null && quote.high52 > quote.low52
      ? Math.min(100, Math.max(0, ((quote.price - quote.low52) / (quote.high52 - quote.low52)) * 100))
      : null;

  return (
    <header className="quote-header">
      <div className="quote-title">
        <h1>{quote.name}</h1>
        <div className="quote-meta">
          <span className="ticker">{symbol.replace(/\.(NS|BO)$/, '')}</span>
          <span className="badge">{quote.exchange || (market === 'IN' ? 'India' : 'US')}</span>
          <span className="badge subtle">{quote.currency}</span>
          <MarketStatusPill market={market} compact />
        </div>
      </div>

      <div className="quote-price-block">
        <div className={`quote-price num ${flash}`}>{formatPrice(quote.price, quote.currency, digits)}</div>
        <div className={`quote-change num ${dir}`}>
          {formatChange(quote.change, quote.currency, digits)} ({formatPct(quote.changePct)})
          <span className="quote-change-label">today</span>
        </div>
        <Freshness symbol={symbol} lastUpdated={lastUpdated} refreshError={refreshError} quote={quote} />
      </div>

      <dl className="quote-stats">
        <div>
          <dt>Day range</dt>
          <dd className="num">
            {formatPrice(quote.dayLow, quote.currency, digits, false)} – {formatPrice(quote.dayHigh, quote.currency, digits, false)}
          </dd>
        </div>
        <div>
          <dt>Prev close</dt>
          <dd className="num">{formatPrice(quote.prevClose, quote.currency, digits, false)}</dd>
        </div>
        {quote.volume != null && quote.type !== 'INDEX' && (
          <div>
            <dt>Volume</dt>
            <dd className="num">{formatVolume(quote.volume, quote.currency)}</dd>
          </div>
        )}
        {range52 != null && (
          <div className="range52">
            <dt>52-week range</dt>
            <dd className="num">
              <span>{formatPrice(quote.low52, quote.currency, digits, false)}</span>
              <span className="range-bar" aria-hidden>
                <span className="range-marker" style={{ left: `${range52}%` }} />
              </span>
              <span>{formatPrice(quote.high52, quote.currency, digits, false)}</span>
            </dd>
          </div>
        )}
      </dl>
    </header>
  );
}
