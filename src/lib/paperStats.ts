/**
 * P&L breakdowns for the Portfolio page, worked out from the order history alone.
 * Fills are replayed in time order with the same average-cost rule as the order engine
 * (paper.ts), so each sale's realised P&L matches what the wallet booked.
 */
import { MARKETS } from './markets.ts';
import type { PaperState, Position } from './paper.ts';
import type { MarketId } from './types.ts';

export interface Fill {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  /** Unix ms. */
  time: number;
  /** qty × price */
  value: number;
  /** Sales only: average cost of the shares sold, and the profit or loss on them. */
  cost?: number;
  realized?: number;
}

/** Filled orders of one wallet, oldest first, each sale carrying its realised P&L. */
export function fillsOf(s: PaperState, market: MarketId): Fill[] {
  const filled = s.orders.filter((o) => o.market === market && o.status === 'filled' && o.fillPrice != null).sort((a, b) => (a.filledAt ?? 0) - (b.filledAt ?? 0));
  const book = new Map<string, { qty: number; avg: number }>();
  return filled.map((o) => {
    const price = o.fillPrice!;
    const value = o.qty * price;
    const pos = book.get(o.symbol) ?? { qty: 0, avg: 0 };
    const f: Fill = { id: o.id, symbol: o.symbol, side: o.side, qty: o.qty, price, time: o.filledAt ?? o.createdAt, value };
    if (o.side === 'buy') {
      pos.avg = (pos.avg * pos.qty + value) / (pos.qty + o.qty);
      pos.qty += o.qty;
    } else {
      f.cost = pos.avg * o.qty;
      f.realized = value - f.cost;
      pos.qty -= o.qty;
      if (pos.qty <= 0) pos.avg = 0;
    }
    book.set(o.symbol, pos);
    return f;
  });
}

/** Calendar day of `t` in the exchange's own time zone, e.g. "2026-11-17". */
export function tradingDay(t: number, market: MarketId): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MARKETS[market].timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

export type Period = 'today' | '7d' | '30d' | 'all';

/** Fills inside a period. "Today" means the exchange's current trading day. */
export function inPeriod(fills: Fill[], period: Period, market: MarketId, now = Date.now()): Fill[] {
  if (period === 'all') return fills;
  if (period === 'today') {
    const today = tradingDay(now, market);
    return fills.filter((f) => tradingDay(f.time, market) === today);
  }
  const days = period === '7d' ? 7 : 30;
  return fills.filter((f) => f.time >= now - days * 86400_000);
}

export interface StockPnl {
  symbol: string;
  boughtQty: number;
  /** Money spent on buys. */
  invested: number;
  soldQty: number;
  /** Money received from sales. */
  proceeds: number;
  /** Average cost of the shares sold. */
  costOfSold: number;
  realized: number;
  /** Realised P&L as % of the cost of the shares sold; null when nothing was sold. */
  realizedPct: number | null;
  trades: number;
  lastTime: number;
}

export function pnlByStock(fills: Fill[]): StockPnl[] {
  const map = new Map<string, StockPnl>();
  for (const f of fills) {
    const r = map.get(f.symbol) ?? { symbol: f.symbol, boughtQty: 0, invested: 0, soldQty: 0, proceeds: 0, costOfSold: 0, realized: 0, realizedPct: null, trades: 0, lastTime: 0 };
    if (f.side === 'buy') {
      r.boughtQty += f.qty;
      r.invested += f.value;
    } else {
      r.soldQty += f.qty;
      r.proceeds += f.value;
      r.costOfSold += f.cost ?? 0;
      r.realized += f.realized ?? 0;
    }
    r.trades++;
    r.lastTime = Math.max(r.lastTime, f.time);
    map.set(f.symbol, r);
  }
  return [...map.values()].map((r) => ({ ...r, realizedPct: r.costOfSold > 0 ? (r.realized / r.costOfSold) * 100 : null })).sort((a, b) => b.lastTime - a.lastTime);
}

export interface DayPnl {
  day: string;
  invested: number;
  proceeds: number;
  realized: number;
  trades: number;
  symbols: string[];
}

/** Newest day first. */
export function pnlByDay(fills: Fill[], market: MarketId): DayPnl[] {
  const map = new Map<string, DayPnl>();
  for (const f of fills) {
    const day = tradingDay(f.time, market);
    const r = map.get(day) ?? { day, invested: 0, proceeds: 0, realized: 0, trades: 0, symbols: [] };
    if (f.side === 'buy') r.invested += f.value;
    else {
      r.proceeds += f.value;
      r.realized += f.realized ?? 0;
    }
    r.trades++;
    if (!r.symbols.includes(f.symbol)) r.symbols.push(f.symbol);
    map.set(day, r);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

export interface TradeStats {
  invested: number;
  proceeds: number;
  realized: number;
  /** Number of sales. */
  sales: number;
  wins: number;
  losses: number;
  /** Share of sales that made money, %; null without sales. */
  winRate: number | null;
  best: Fill | null;
  worst: Fill | null;
}

export function tradeStats(fills: Fill[]): TradeStats {
  const sales = fills.filter((f) => f.side === 'sell');
  const wins = sales.filter((f) => (f.realized ?? 0) > 0.005).length;
  const losses = sales.filter((f) => (f.realized ?? 0) < -0.005).length;
  const byRealized = [...sales].sort((a, b) => (b.realized ?? 0) - (a.realized ?? 0));
  return {
    invested: fills.filter((f) => f.side === 'buy').reduce((a, f) => a + f.value, 0),
    proceeds: sales.reduce((a, f) => a + f.value, 0),
    realized: sales.reduce((a, f) => a + (f.realized ?? 0), 0),
    sales: sales.length,
    wins,
    losses,
    winRate: sales.length ? (wins / sales.length) * 100 : null,
    best: byRealized[0] && (byRealized[0].realized ?? 0) > 0 ? byRealized[0] : null,
    worst: byRealized.length && (byRealized[byRealized.length - 1].realized ?? 0) < 0 ? byRealized[byRealized.length - 1] : null,
  };
}

export interface Contribution {
  symbol: string;
  /** Money gained (+) or lost (−). */
  pnl: number;
  /** As % of the cost behind it; null when unknown. */
  pct: number | null;
  /** Unrealised only: shares held, priced or not. */
  qty?: number;
  priced?: boolean;
}

/** Each holding's unrealised P&L at the latest prices, biggest winners first. */
export function unrealizedByStock(positions: Position[], prices: Record<string, number | undefined>): Contribution[] {
  return positions
    .map((p) => {
      const last = prices[p.symbol];
      const pnl = last != null ? (last - p.avgCost) * p.qty : 0;
      return { symbol: p.symbol, pnl, pct: last != null && p.avgCost ? ((last - p.avgCost) / p.avgCost) * 100 : null, qty: p.qty, priced: last != null };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

/** Each stock's realised P&L over all its sales, biggest winners first. */
export function realizedByStock(fills: Fill[]): Contribution[] {
  return pnlByStock(fills)
    .filter((r) => r.soldQty > 0)
    .map((r) => ({ symbol: r.symbol, pnl: r.realized, pct: r.realizedPct }))
    .sort((a, b) => b.pnl - a.pnl);
}

// ------------------------------------------------------------------ snapshot for Ask AI

export interface HoldingFacts {
  symbol: string;
  name?: string;
  sector?: string;
  qty: number;
  avgCost: number;
  lastPrice: number | null;
  value: number;
  /** Share of the wallet's account value (cash + holdings), %. */
  weightPct: number;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  todayChangePct: number | null;
  firstBought: string | null;
}

export interface PortfolioSnapshot {
  market: MarketId;
  currency: string;
  simulated: true;
  startingBudget: number;
  cash: number;
  cashPct: number;
  holdingsValue: number;
  accountValue: number;
  totalReturnPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  holdings: HoldingFacts[];
  sectorWeightsPct: Array<{ sector: string; weightPct: number }>;
  realizedByStock: Array<{ symbol: string; pnl: number; pct: number | null }>;
  trades: { sales: number; wins: number; losses: number; winRatePct: number | null; bestSale: string | null; worstSale: string | null };
  recentTrades: Array<{ day: string; symbol: string; side: string; qty: number; price: number; realizedPnl?: number }>;
  workingOrders: number;
  pricesMissingFor: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Everything Ask AI needs to describe one wallet: facts only, rounded, with names and sectors
 * so it can talk about concentration. Built on demand when the visitor asks; never sent otherwise.
 */
export function portfolioSnapshot(
  s: PaperState,
  market: MarketId,
  prices: Record<string, number | undefined>,
  info: Record<string, { name?: string; sector?: string; changePct?: number | null } | undefined>,
): PortfolioSnapshot {
  const w = s.wallets[market];
  const fills = fillsOf(s, market);
  const positions = s.positions.filter((p) => p.market === market);
  const holdingsValue = positions.reduce((a, p) => a + p.qty * (prices[p.symbol] ?? p.avgCost), 0);
  const accountValue = w.cash + holdingsValue;
  const firstBuy = new Map<string, number>();
  for (const f of fills) if (f.side === 'buy' && !firstBuy.has(f.symbol)) firstBuy.set(f.symbol, f.time);

  const holdings: HoldingFacts[] = positions
    .map((p) => {
      const last = prices[p.symbol] ?? null;
      const value = p.qty * (last ?? p.avgCost);
      const i = info[p.symbol];
      return {
        symbol: p.symbol,
        name: i?.name,
        sector: i?.sector,
        qty: p.qty,
        avgCost: r2(p.avgCost),
        lastPrice: last,
        value: r2(value),
        weightPct: accountValue ? r2((value / accountValue) * 100) : 0,
        unrealizedPnl: last != null ? r2((last - p.avgCost) * p.qty) : null,
        unrealizedPct: last != null && p.avgCost ? r2(((last - p.avgCost) / p.avgCost) * 100) : null,
        todayChangePct: i?.changePct != null ? r2(i.changePct) : null,
        firstBought: firstBuy.has(p.symbol) ? tradingDay(firstBuy.get(p.symbol)!, market) : null,
      };
    })
    .sort((a, b) => b.value - a.value);

  const bySector = new Map<string, number>();
  for (const h of holdings) bySector.set(h.sector ?? 'Unknown', (bySector.get(h.sector ?? 'Unknown') ?? 0) + h.value);
  const stats = tradeStats(fills);
  const saleLabel = (f: Fill | null) => (f ? `${f.symbol} ${f.realized! >= 0 ? '+' : ''}${r2(f.realized!)} on ${tradingDay(f.time, market)}` : null);

  return {
    market,
    currency: market === 'IN' ? 'INR' : 'USD',
    simulated: true,
    startingBudget: w.start,
    cash: r2(w.cash),
    cashPct: accountValue ? r2((w.cash / accountValue) * 100) : 100,
    holdingsValue: r2(holdingsValue),
    accountValue: r2(accountValue),
    totalReturnPct: w.start ? r2(((accountValue - w.start) / w.start) * 100) : 0,
    realizedPnl: r2(w.realized),
    unrealizedPnl: r2(holdings.reduce((a, h) => a + (h.unrealizedPnl ?? 0), 0)),
    holdings,
    sectorWeightsPct: [...bySector.entries()].map(([sector, v]) => ({ sector, weightPct: accountValue ? r2((v / accountValue) * 100) : 0 })).sort((a, b) => b.weightPct - a.weightPct),
    realizedByStock: realizedByStock(fills).map((c) => ({ symbol: c.symbol, pnl: r2(c.pnl), pct: c.pct == null ? null : r2(c.pct) })),
    trades: { sales: stats.sales, wins: stats.wins, losses: stats.losses, winRatePct: stats.winRate == null ? null : Math.round(stats.winRate), bestSale: saleLabel(stats.best), worstSale: saleLabel(stats.worst) },
    recentTrades: fills
      .slice(-12)
      .reverse()
      .map((f) => ({ day: tradingDay(f.time, market), symbol: f.symbol, side: f.side, qty: f.qty, price: r2(f.price), ...(f.realized != null ? { realizedPnl: r2(f.realized) } : {}) })),
    workingOrders: s.orders.filter((o) => o.market === market && o.status === 'open').length,
    pricesMissingFor: positions.filter((p) => prices[p.symbol] == null).map((p) => p.symbol),
  };
}
