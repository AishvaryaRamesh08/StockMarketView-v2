/**
 * Paper-trading engine: virtual wallets, orders, fills and P&L. Pure functions over a plain
 * state object, so every rule is unit-tested and the state can be saved, exported and imported
 * as JSON.
 *
 * Rules (also shown to the user):
 *  - Separate INR and USD wallets, no currency conversion.
 *  - Long only, whole shares only.
 *  - Market orders fill at the latest polled price. While the stock's market is closed they
 *    queue and fill at the first price traded after the next open.
 *  - Limit and stop orders fill at the polled price once it crosses their trigger.
 *  - Orders are only checked while the site is open in a tab. Fills ignore slippage, fees,
 *    dividends and splits.
 */
import type { MarketId } from './types.ts';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'rejected';

export interface Order {
  id: string;
  symbol: string;
  market: MarketId;
  side: Side;
  type: OrderType;
  qty: number;
  /** Trigger price for limit and stop orders. */
  price?: number;
  /** Market orders: the price when placed, used to set aside cash until the order fills. */
  estPrice?: number;
  /** Unix ms when placed. */
  createdAt: number;
  status: OrderStatus;
  /** Unix ms and price of the fill. */
  filledAt?: number;
  fillPrice?: number;
  /** Why it was rejected or cancelled. */
  note?: string;
}

export interface Position {
  symbol: string;
  market: MarketId;
  qty: number;
  avgCost: number;
}

export interface Wallet {
  /** Starting budget, the base for total return. */
  start: number;
  cash: number;
  realized: number;
}

export interface EquityPoint {
  /** Unix ms. */
  t: number;
  v: number;
}

export interface PaperState {
  version: 1;
  createdAt: number;
  wallets: Record<MarketId, Wallet>;
  positions: Position[];
  /** Every order ever placed, newest last. Open ones are the working orders. */
  orders: Order[];
  equity: Record<MarketId, EquityPoint[]>;
}

/** What the engine needs to know about a symbol's latest price. */
export interface PriceTick {
  price: number;
  /** Unix ms of the last trade the provider reported. */
  time: number;
}

export const DEFAULT_BUDGET: Record<MarketId, number> = { IN: 1_000_000, US: 100_000 };
export const CURRENCY: Record<MarketId, string> = { IN: 'INR', US: 'USD' };
const MAX_EQUITY_POINTS = 2000;
const EQUITY_EVERY_MS = 10 * 60_000;

export function newPaperState(budget: Record<MarketId, number> = DEFAULT_BUDGET, now = Date.now()): PaperState {
  return {
    version: 1,
    createdAt: now,
    wallets: {
      IN: { start: budget.IN, cash: budget.IN, realized: 0 },
      US: { start: budget.US, cash: budget.US, realized: 0 },
    },
    positions: [],
    orders: [],
    equity: { IN: [{ t: now, v: budget.IN }], US: [{ t: now, v: budget.US }] },
  };
}

const id = () => Math.random().toString(36).slice(2, 10);
const round2 = (x: number) => Math.round(x * 100) / 100;

export function positionOf(s: PaperState, symbol: string): Position | undefined {
  return s.positions.find((p) => p.symbol === symbol);
}

export function openOrders(s: PaperState, symbol?: string): Order[] {
  return s.orders.filter((o) => o.status === 'open' && (!symbol || o.symbol === symbol));
}

/** Cash set aside for working buy orders, so two orders can't spend the same money. */
export function reservedCash(s: PaperState, market: MarketId, ticks: Record<string, PriceTick | undefined> = {}): number {
  return openOrders(s)
    .filter((o) => o.market === market && o.side === 'buy')
    .reduce((sum, o) => sum + o.qty * (o.price ?? ticks[o.symbol]?.price ?? o.estPrice ?? 0), 0);
}

/** Shares already promised to working sell orders. */
export function reservedShares(s: PaperState, symbol: string): number {
  return openOrders(s, symbol)
    .filter((o) => o.side === 'sell')
    .reduce((sum, o) => sum + o.qty, 0);
}

export interface OrderInput {
  symbol: string;
  market: MarketId;
  side: Side;
  type: OrderType;
  qty: number;
  price?: number;
}

export interface PlaceResult {
  state: PaperState;
  order?: Order;
  error?: string;
}

/**
 * Validates and places an order. A market order while the market is open (and a price is
 * known) fills straight away; everything else waits for processTicks.
 */
export function placeOrder(s: PaperState, input: OrderInput, tick: PriceTick | undefined, marketOpen: boolean, now = Date.now()): PlaceResult {
  const { symbol, market, side, type, qty } = input;
  if (!Number.isInteger(qty) || qty < 1) return { state: s, error: 'Quantity must be a whole number of shares, at least 1.' };
  if (type !== 'market' && !(input.price && input.price > 0)) return { state: s, error: `Enter a ${type} price above zero.` };

  if (side === 'sell') {
    const held = positionOf(s, symbol)?.qty ?? 0;
    const free = held - reservedShares(s, symbol);
    if (held === 0) return { state: s, error: "You don't hold this stock. Paper trading is long-only, so you can't sell short." };
    if (qty > free) return { state: s, error: `You can sell at most ${free} share${free === 1 ? '' : 's'} (${held} held${held !== free ? `, ${held - free} already in open sell orders` : ''}).` };
  } else {
    const estPrice = type === 'market' ? tick?.price : input.price;
    if (estPrice == null) return { state: s, error: 'No price yet for this stock; try again in a moment.' };
    const available = s.wallets[market].cash - reservedCash(s, market);
    if (qty * estPrice > available + 1e-9) {
      return { state: s, error: `Not enough cash: this needs about ${round2(qty * estPrice)} and ${round2(Math.max(0, available))} is available.` };
    }
  }

  const order: Order = { id: id(), symbol, market, side, type, qty, price: type === 'market' ? undefined : input.price, estPrice: type === 'market' ? tick?.price : undefined, createdAt: now, status: 'open' };
  const next: PaperState = { ...s, orders: [...s.orders, order] };
  if (type === 'market' && marketOpen && tick) {
    const r = fill(next, order, tick.price, now);
    return { state: r.state, order: r.order };
  }
  return { state: next, order };
}

export function cancelOrder(s: PaperState, orderId: string, now = Date.now()): PaperState {
  return {
    ...s,
    orders: s.orders.map((o) => (o.id === orderId && o.status === 'open' ? { ...o, status: 'cancelled', filledAt: now, note: 'Cancelled by you' } : o)),
  };
}

/** Executes one order at `price`, updating cash, the position and realised P&L. */
function fill(s: PaperState, order: Order, price: number, now: number): { state: PaperState; order: Order } {
  const wallet = { ...s.wallets[order.market] };
  const positions = s.positions.map((p) => ({ ...p }));
  let pos = positions.find((p) => p.symbol === order.symbol);
  const value = order.qty * price;

  if (order.side === 'buy') {
    if (value > wallet.cash + 1e-9) {
      const rejected: Order = { ...order, status: 'rejected', filledAt: now, note: `Not enough cash at ${round2(price)}` };
      return { state: { ...s, orders: s.orders.map((o) => (o.id === order.id ? rejected : o)) }, order: rejected };
    }
    wallet.cash -= value;
    if (pos) {
      pos.avgCost = (pos.avgCost * pos.qty + value) / (pos.qty + order.qty);
      pos.qty += order.qty;
    } else {
      pos = { symbol: order.symbol, market: order.market, qty: order.qty, avgCost: price };
      positions.push(pos);
    }
  } else {
    const held = pos?.qty ?? 0;
    if (!pos || order.qty > held) {
      const rejected: Order = { ...order, status: 'rejected', filledAt: now, note: 'Not enough shares' };
      return { state: { ...s, orders: s.orders.map((o) => (o.id === order.id ? rejected : o)) }, order: rejected };
    }
    wallet.cash += value;
    wallet.realized += (price - pos.avgCost) * order.qty;
    pos.qty -= order.qty;
  }

  const done: Order = { ...order, status: 'filled', filledAt: now, fillPrice: price };
  return {
    state: {
      ...s,
      wallets: { ...s.wallets, [order.market]: wallet },
      positions: positions.filter((p) => p.qty > 0),
      orders: s.orders.map((o) => (o.id === order.id ? done : o)),
    },
    order: done,
  };
}

/** Would this working order trigger at `price`? */
export function triggers(o: Order, price: number): boolean {
  if (o.type === 'market') return true;
  const p = o.price!;
  if (o.type === 'limit') return o.side === 'buy' ? price <= p : price >= p;
  return o.side === 'buy' ? price >= p : price <= p; // stop
}

/**
 * Checks every working order against fresh prices. Only a trade that happened after the order
 * was placed, while its market is open, can fill it. Returns the orders that changed.
 */
export function processTicks(
  s: PaperState,
  ticks: Record<string, PriceTick | undefined>,
  isOpen: (m: MarketId) => boolean,
  now = Date.now(),
): { state: PaperState; changed: Order[] } {
  let state = s;
  const changed: Order[] = [];
  for (const o of openOrders(s)) {
    const tick = ticks[o.symbol];
    if (!tick || !isOpen(o.market) || tick.time <= o.createdAt) continue;
    const current = state.orders.find((x) => x.id === o.id);
    if (!current || current.status !== 'open' || !triggers(current, tick.price)) continue;
    const r = fill(state, current, tick.price, now);
    state = r.state;
    changed.push(r.order);
  }
  return { state, changed };
}

export interface MarketSummary {
  market: MarketId;
  start: number;
  cash: number;
  holdingsValue: number;
  equity: number;
  unrealized: number;
  realized: number;
  /** Equity versus starting budget, as a %. */
  totalReturnPct: number;
  /** True when some holding has no current price (valued at cost). */
  priceMissing: boolean;
}

export function summarize(s: PaperState, market: MarketId, prices: Record<string, number | undefined>): MarketSummary {
  const w = s.wallets[market];
  let holdingsValue = 0;
  let unrealized = 0;
  let priceMissing = false;
  for (const p of s.positions.filter((x) => x.market === market)) {
    const px = prices[p.symbol];
    if (px == null) priceMissing = true;
    const last = px ?? p.avgCost;
    holdingsValue += p.qty * last;
    unrealized += p.qty * (last - p.avgCost);
  }
  const equity = w.cash + holdingsValue;
  return { market, start: w.start, cash: w.cash, holdingsValue, equity, unrealized, realized: w.realized, totalReturnPct: w.start ? ((equity - w.start) / w.start) * 100 : 0, priceMissing };
}

/** Adds an equity point when enough time has passed or after a fill. */
export function recordEquity(s: PaperState, market: MarketId, equity: number, now = Date.now(), force = false): PaperState {
  const pts = s.equity[market];
  const last = pts[pts.length - 1];
  if (!force && last && now - last.t < EQUITY_EVERY_MS) return s;
  if (last && Math.abs(last.v - equity) < 0.005 && !force) return s;
  const next = [...pts, { t: now, v: round2(equity) }].slice(-MAX_EQUITY_POINTS);
  return { ...s, equity: { ...s.equity, [market]: next } };
}

/** Checks an imported file before it replaces anything. */
export function isPaperState(v: unknown): v is PaperState {
  const s = v as PaperState;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const wallet = (w: Wallet) => !!w && num(w.start) && num(w.cash) && num(w.realized);
  const market = (m: unknown) => m === 'IN' || m === 'US';
  return (
    !!s &&
    s.version === 1 &&
    num(s.createdAt) &&
    !!s.wallets &&
    wallet(s.wallets.IN) &&
    wallet(s.wallets.US) &&
    Array.isArray(s.positions) &&
    s.positions.every((p) => typeof p.symbol === 'string' && market(p.market) && Number.isInteger(p.qty) && p.qty > 0 && num(p.avgCost)) &&
    Array.isArray(s.orders) &&
    s.orders.every(
      (o) =>
        typeof o.id === 'string' &&
        typeof o.symbol === 'string' &&
        market(o.market) &&
        (o.side === 'buy' || o.side === 'sell') &&
        ['market', 'limit', 'stop'].includes(o.type) &&
        Number.isInteger(o.qty) &&
        ['open', 'filled', 'cancelled', 'rejected'].includes(o.status),
    ) &&
    !!s.equity &&
    Array.isArray(s.equity.IN) &&
    Array.isArray(s.equity.US)
  );
}
