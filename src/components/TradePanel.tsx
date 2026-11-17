import { useEffect, useState } from 'react';
import type { PaperApi } from '../hooks/usePaper.ts';
import { digitsFor, formatPct, formatPrice } from '../lib/format.ts';
import { MARKETS, marketStatus } from '../lib/markets.ts';
import { CURRENCY, openOrders, positionOf, reservedCash, reservedShares, type OrderType, type Side } from '../lib/paper.ts';
import type { MarketId, Quote } from '../lib/types.ts';
import { InfoTip } from './InfoTip.tsx';

interface Props {
  symbol: string;
  market: MarketId;
  quote: Quote | null;
  paper: PaperApi;
  onToast: (message: string) => void;
  onOpenPortfolio: () => void;
  onClose?: () => void;
}

const TYPE_HELP: Record<OrderType, string> = {
  market: 'Buy or sell now at the latest price. If the market is closed, it waits and fills at the first price after the open.',
  limit: 'Buy only at this price or lower, or sell only at this price or higher. Waits until the price gets there.',
  stop: 'Triggers once the price moves through this level: a stop sell limits a loss, a stop buy catches a breakout.',
};

/** The order ticket for the open stock, plus its position and working orders. */
export function TradePanel({ symbol, market, quote, paper, onToast, onOpenPortfolio, onClose }: Props) {
  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currency = CURRENCY[market];
  const last = quote?.price ?? null;
  const digits = digitsFor(quote?.priceHint, last);
  const fmt = (v: number | null | undefined) => formatPrice(v, currency, digits);
  const isIndex = symbol.startsWith('^');

  // New stock or order type: start from the current price.
  useEffect(() => {
    setError(null);
    if (type !== 'market' && last != null) setPrice(last.toFixed(digits));
  }, [symbol, type]);
  useEffect(() => setError(null), [side, qty, price]);

  const s = paper.state;
  const pos = positionOf(s, symbol);
  const status = marketStatus(market);
  const open = status.state === 'open';
  const available = s.wallets[market].cash - reservedCash(s, market, paper.ticks);
  const freeShares = (pos?.qty ?? 0) - reservedShares(s, symbol);
  const n = Number(qty);
  const px = type === 'market' ? last : Number(price) || null;
  const estimate = px != null && Number.isFinite(n) ? n * px : null;
  const working = openOrders(s, symbol);

  const maxQty = () => {
    if (side === 'sell') return Math.max(0, freeShares);
    if (!px) return 0;
    return Math.max(0, Math.floor(available / px));
  };

  const submit = () => {
    const r = paper.place({ symbol, market, side, type, qty: n, price: type === 'market' ? undefined : Number(price) });
    if (r.error) return setError(r.error);
    const o = r.order!;
    const ticker = symbol.replace(/\.(NS|BO)$/, '');
    if (o.status === 'filled') onToast(`${side === 'buy' ? 'Bought' : 'Sold'} ${o.qty} ${ticker} at ${fmt(o.fillPrice)} (simulated)`);
    else onToast(`${type === 'market' ? 'Market' : type === 'limit' ? 'Limit' : 'Stop'} order placed: ${side} ${o.qty} ${ticker}${type === 'market' ? `, fills after ${MARKETS[market].name} opens` : ` at ${fmt(o.price)}`}`);
  };

  if (isIndex) {
    return (
      <aside className="trade-panel" aria-label="Paper trade">
        <PanelHead onClose={onClose} />
        <p className="empty-note">Indices can't be bought directly. Open a stock or ETF to paper trade it.</p>
      </aside>
    );
  }

  return (
    <aside className="trade-panel" aria-label="Paper trade">
      <PanelHead onClose={onClose} />

      <div className="tp-wallet">
        <span>Cash available</span>
        <b className="num">{formatPrice(Math.max(0, available), currency)}</b>
      </div>

      {pos && (
        <div className="tp-position">
          <div>
            You hold <b>{pos.qty}</b> at avg <b className="num">{fmt(pos.avgCost)}</b>
          </div>
          {last != null && (
            <div className={`num ${last >= pos.avgCost ? 'up' : 'down'}`}>
              {last >= pos.avgCost ? '+' : '−'}
              {formatPrice(Math.abs((last - pos.avgCost) * pos.qty), currency)} ({formatPct(((last - pos.avgCost) / pos.avgCost) * 100)})
            </div>
          )}
        </div>
      )}

      <div className="tp-sides" role="radiogroup" aria-label="Buy or sell">
        <button role="radio" aria-checked={side === 'buy'} className={`tp-side buy ${side === 'buy' ? 'active' : ''}`} onClick={() => setSide('buy')}>
          Buy
        </button>
        <button role="radio" aria-checked={side === 'sell'} className={`tp-side sell ${side === 'sell' ? 'active' : ''}`} onClick={() => setSide('sell')}>
          Sell
        </button>
      </div>

      <div className="tp-field">
        <span className="tp-label">
          Order type
          <InfoTip text={TYPE_HELP[type]}>
            <span className="help" tabIndex={0}>
              ?
            </span>
          </InfoTip>
        </span>
        <div className="segmented text tp-types" role="radiogroup" aria-label="Order type">
          {(['market', 'limit', 'stop'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={type === t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <label className="tp-field">
        <span className="tp-label">Quantity (shares)</span>
        <span className="tp-input-row">
          <input type="number" inputMode="numeric" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" />
          <button className="link" type="button" onClick={() => setQty(String(maxQty()))}>
            Max {maxQty()}
          </button>
        </span>
      </label>

      {type !== 'market' && (
        <label className="tp-field">
          <span className="tp-label">{type === 'limit' ? 'Limit price' : 'Stop price'}</span>
          <input type="number" inputMode="decimal" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} aria-label={`${type} price`} />
        </label>
      )}

      <div className="tp-estimate">
        <span>{side === 'buy' ? 'Estimated cost' : 'Estimated proceeds'}</span>
        <b className="num">{estimate != null ? fmt(estimate) : '—'}</b>
      </div>

      {!open && type === 'market' && (
        <p className="tp-note">
          {MARKETS[market].name} market is {status.state === 'holiday' ? `closed for ${status.label}` : 'closed'}. This order will wait and fill at the first price after it opens.
        </p>
      )}

      {error && (
        <p className="tp-error" role="alert">
          {error}
        </p>
      )}

      <button className={`btn tp-submit ${side}`} onClick={submit} disabled={!qty || last == null}>
        {side === 'buy' ? 'Buy' : 'Sell'} {Number.isFinite(n) && n > 0 ? n : ''} {symbol.replace(/\.(NS|BO)$/, '')}
        {type !== 'market' ? ` at ${type}` : ''}
      </button>

      {working.length > 0 && (
        <div className="tp-orders">
          <h3>Working orders</h3>
          {working.map((o) => (
            <div key={o.id} className="tp-order">
              <span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? 'Buy' : 'Sell'}</span>
              <span>
                {o.qty} · {o.type}
                {o.price != null ? ` ${fmt(o.price)}` : ' (at open)'}
              </span>
              <button className="link" onClick={() => paper.cancel(o.id)} aria-label={`Cancel ${o.side} ${o.qty} ${o.type} order`}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="tp-disclaimer">
        Simulated with virtual money. Orders are only checked while this site is open in a tab; fills ignore slippage, fees, dividends and splits.
      </p>
      <button className="link" onClick={onOpenPortfolio}>
        View portfolio →
      </button>
    </aside>
  );
}

function PanelHead({ onClose }: { onClose?: () => void }) {
  return (
    <div className="tp-head">
      <h2>Paper trade</h2>
      <span className="badge subtle">Simulated</span>
      {onClose && (
        <button className="icon-btn" onClick={onClose} aria-label="Close trade panel" title="Close">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}
