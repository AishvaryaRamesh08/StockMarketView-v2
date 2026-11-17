/**
 * Replay mode: the chart hides the future and steps forward one candle at a time, with a
 * practice account that trades at each candle's close. Kept apart from the paper account, so
 * practising on 2021 prices never touches today's portfolio.
 */
import type { IntervalId, PeriodId } from './ranges.ts';
import type { MarketId } from './types.ts';

/** How much history to load for each candle size (the most the data source serves). */
export function replayRange(interval: IntervalId): PeriodId {
  return ({ '1m': '5d', '2m': '1mo', '5m': '1mo', '15m': '1mo', '30m': '1mo', '60m': '1y', '1d': '10y', '1wk': 'max', '1mo': 'max' } as const)[interval];
}

/** Where a new replay starts: about a year back on daily candles, with enough history before it for indicators. */
export function replayStart(count: number, interval: IntervalId): number {
  const back = ({ '1d': 250, '1wk': 104, '1mo': 60, '60m': 300 } as Partial<Record<IntervalId, number>>)[interval] ?? Math.floor(count / 2);
  const minContext = Math.min(60, Math.max(1, count - 2));
  return Math.max(minContext, Math.min(count - 2, count - 1 - back));
}

export const PRACTICE_CASH: Record<MarketId, number> = { IN: 100_000, US: 10_000 };

export interface ReplayTrade {
  /** Unix seconds of the candle. */
  t: number;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  realized?: number;
}

export interface ReplayAccount {
  start: number;
  cash: number;
  qty: number;
  avg: number;
  realized: number;
  trades: ReplayTrade[];
}

export function newAccount(market: MarketId): ReplayAccount {
  return { start: PRACTICE_CASH[market], cash: PRACTICE_CASH[market], qty: 0, avg: 0, realized: 0, trades: [] };
}

/** Whole shares at the candle's close. Returns the new account, or why it can't. */
export function buyIn(a: ReplayAccount, qty: number, price: number, t: number): ReplayAccount | string {
  if (!Number.isInteger(qty) || qty < 1) return 'Enter a whole number of shares';
  if (qty * price > a.cash + 1e-9) return `Not enough practice cash (max ${Math.floor(a.cash / price)})`;
  return {
    ...a,
    cash: a.cash - qty * price,
    avg: (a.avg * a.qty + qty * price) / (a.qty + qty),
    qty: a.qty + qty,
    trades: [...a.trades, { t, side: 'buy', qty, price }],
  };
}

export function sellOut(a: ReplayAccount, qty: number, price: number, t: number): ReplayAccount | string {
  if (!Number.isInteger(qty) || qty < 1) return 'Enter a whole number of shares';
  if (qty > a.qty) return a.qty ? `You hold ${a.qty}` : 'Nothing to sell';
  const realized = (price - a.avg) * qty;
  const left = a.qty - qty;
  return { ...a, cash: a.cash + qty * price, qty: left, avg: left ? a.avg : 0, realized: a.realized + realized, trades: [...a.trades, { t, side: 'sell', qty, price, realized }] };
}

export function equityOf(a: ReplayAccount, price: number): number {
  return a.cash + a.qty * price;
}
