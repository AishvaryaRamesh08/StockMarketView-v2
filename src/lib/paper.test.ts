import { describe, expect, it } from 'vitest';
import { cancelOrder, isPaperState, newPaperState, openOrders, placeOrder, positionOf, processTicks, recordEquity, reservedCash, summarize, triggers, type PaperState } from './paper.ts';

const T0 = 1_000_000;
const tick = (price: number, time = T0 + 1) => ({ price, time });
const open = () => true;
const closed = () => false;
const fresh = () => newPaperState({ IN: 100_000, US: 10_000 }, T0);

function buy(s: PaperState, symbol: string, qty: number, price: number, isOpen = true) {
  return placeOrder(s, { symbol, market: 'US', side: 'buy', type: 'market', qty }, tick(price), isOpen, T0);
}

describe('market orders', () => {
  it('fill immediately while the market is open', () => {
    const r = buy(fresh(), 'AAPL', 10, 150);
    expect(r.order?.status).toBe('filled');
    expect(r.order?.fillPrice).toBe(150);
    expect(r.state.wallets.US.cash).toBe(8_500);
    expect(positionOf(r.state, 'AAPL')).toMatchObject({ qty: 10, avgCost: 150 });
  });
  it('queue while the market is closed and fill at the first trade after the open', () => {
    let s = buy(fresh(), 'AAPL', 10, 150, false).state;
    expect(openOrders(s)).toHaveLength(1);
    // A stale quote from before the order (yesterday's close) must not fill it.
    expect(processTicks(s, { AAPL: tick(149, T0 - 1) }, open, T0 + 5).changed).toHaveLength(0);
    // Still closed: no fill.
    expect(processTicks(s, { AAPL: tick(151, T0 + 10) }, closed, T0 + 10).changed).toHaveLength(0);
    const r = processTicks(s, { AAPL: tick(152, T0 + 20) }, open, T0 + 20);
    s = r.state;
    expect(r.changed[0]).toMatchObject({ status: 'filled', fillPrice: 152 });
    expect(s.wallets.US.cash).toBe(10_000 - 1_520);
  });
});

describe('order validation', () => {
  it('accepts whole shares only', () => {
    expect(placeOrder(fresh(), { symbol: 'AAPL', market: 'US', side: 'buy', type: 'market', qty: 1.5 }, tick(10), true).error).toMatch(/whole number/);
    expect(placeOrder(fresh(), { symbol: 'AAPL', market: 'US', side: 'buy', type: 'market', qty: 0 }, tick(10), true).error).toMatch(/at least 1/);
  });
  it('rejects buys the wallet cannot afford, counting cash reserved by open orders', () => {
    expect(buy(fresh(), 'AAPL', 100, 150).error).toMatch(/Not enough cash/);
    let s = placeOrder(fresh(), { symbol: 'AAPL', market: 'US', side: 'buy', type: 'limit', qty: 60, price: 100 }, tick(120), true, T0).state;
    expect(reservedCash(s, 'US')).toBe(6_000);
    expect(placeOrder(s, { symbol: 'MSFT', market: 'US', side: 'buy', type: 'limit', qty: 50, price: 100 }, tick(110), true, T0).error).toMatch(/Not enough cash/);
    s = cancelOrder(s, openOrders(s)[0].id);
    expect(placeOrder(s, { symbol: 'MSFT', market: 'US', side: 'buy', type: 'limit', qty: 50, price: 100 }, tick(110), true, T0).error).toBeUndefined();
  });
  it('sets aside cash for a market order queued while the market is closed', () => {
    const s = buy(fresh(), 'AAPL', 50, 150, false).state; // 7,500 queued, nothing spent yet
    expect(s.wallets.US.cash).toBe(10_000);
    expect(reservedCash(s, 'US')).toBe(7_500);
    expect(buy(s, 'MSFT', 20, 150, false).error).toMatch(/Not enough cash/);
  });
  it('keeps the wallets separate: rupees cannot buy US stocks', () => {
    const s = newPaperState({ IN: 1_000_000, US: 0 }, T0);
    expect(buy(s, 'AAPL', 1, 150).error).toMatch(/Not enough cash/);
  });
  it('is long-only: no selling what you do not hold, or more than you hold', () => {
    expect(placeOrder(fresh(), { symbol: 'AAPL', market: 'US', side: 'sell', type: 'market', qty: 1 }, tick(150), true).error).toMatch(/long-only/);
    const s = buy(fresh(), 'AAPL', 10, 150).state;
    expect(placeOrder(s, { symbol: 'AAPL', market: 'US', side: 'sell', type: 'market', qty: 11 }, tick(150), true).error).toMatch(/at most 10/);
  });
  it('counts shares already promised to open sell orders', () => {
    let s = buy(fresh(), 'AAPL', 10, 150).state;
    s = placeOrder(s, { symbol: 'AAPL', market: 'US', side: 'sell', type: 'limit', qty: 7, price: 200 }, tick(150), true, T0).state;
    expect(placeOrder(s, { symbol: 'AAPL', market: 'US', side: 'sell', type: 'market', qty: 4 }, tick(150), true).error).toMatch(/at most 3/);
  });
  it('requires a price for limit and stop orders', () => {
    expect(placeOrder(fresh(), { symbol: 'AAPL', market: 'US', side: 'buy', type: 'limit', qty: 1 }, tick(150), true).error).toMatch(/limit price/);
  });
});

describe('triggers', () => {
  const o = (side: 'buy' | 'sell', type: 'limit' | 'stop') => ({ id: 'x', symbol: 'A', market: 'US' as const, side, type, qty: 1, price: 100, createdAt: 0, status: 'open' as const });
  it('limit buys at or below, limit sells at or above', () => {
    expect(triggers(o('buy', 'limit'), 100)).toBe(true);
    expect(triggers(o('buy', 'limit'), 100.01)).toBe(false);
    expect(triggers(o('sell', 'limit'), 99.99)).toBe(false);
    expect(triggers(o('sell', 'limit'), 101)).toBe(true);
  });
  it('stop buys at or above, stop sells at or below', () => {
    expect(triggers(o('buy', 'stop'), 99)).toBe(false);
    expect(triggers(o('buy', 'stop'), 100)).toBe(true);
    expect(triggers(o('sell', 'stop'), 100.5)).toBe(false);
    expect(triggers(o('sell', 'stop'), 95)).toBe(true);
  });
  it('fills a triggered limit order at the polled price, which may be better than the limit', () => {
    let s = placeOrder(fresh(), { symbol: 'AAPL', market: 'US', side: 'buy', type: 'limit', qty: 10, price: 100 }, tick(110), true, T0).state;
    expect(processTicks(s, { AAPL: tick(101) }, open, T0 + 2).changed).toHaveLength(0);
    const r = processTicks(s, { AAPL: tick(97) }, open, T0 + 3);
    expect(r.changed[0]).toMatchObject({ status: 'filled', fillPrice: 97 });
    s = r.state;
    expect(s.wallets.US.cash).toBe(10_000 - 970);
  });
});

describe('positions and P&L', () => {
  it('averages the cost on additional buys', () => {
    let s = buy(fresh(), 'AAPL', 10, 100).state;
    s = buy(s, 'AAPL', 30, 120).state;
    expect(positionOf(s, 'AAPL')).toMatchObject({ qty: 40, avgCost: 115 });
  });
  it('books realised P&L on sells and closes the position at zero', () => {
    let s = buy(fresh(), 'AAPL', 10, 100).state;
    s = placeOrder(s, { symbol: 'AAPL', market: 'US', side: 'sell', type: 'market', qty: 4 }, tick(130), true, T0).state;
    expect(s.wallets.US.realized).toBe(120);
    expect(positionOf(s, 'AAPL')).toMatchObject({ qty: 6, avgCost: 100 });
    s = placeOrder(s, { symbol: 'AAPL', market: 'US', side: 'sell', type: 'market', qty: 6 }, tick(90), true, T0).state;
    expect(s.wallets.US.realized).toBe(60);
    expect(positionOf(s, 'AAPL')).toBeUndefined();
    expect(s.wallets.US.cash).toBe(10_000 - 1_000 + 520 + 540);
  });
  it('summarises equity, unrealised P&L and total return', () => {
    let s = buy(fresh(), 'AAPL', 10, 100).state;
    s = placeOrder(s, { symbol: 'AAPL', market: 'US', side: 'sell', type: 'market', qty: 5 }, tick(110), true, T0).state;
    const sum = summarize(s, 'US', { AAPL: 120 });
    expect(sum).toMatchObject({ cash: 9_550, holdingsValue: 600, equity: 10_150, unrealized: 100, realized: 50, priceMissing: false });
    expect(sum.totalReturnPct).toBeCloseTo(1.5, 10);
    expect(summarize(s, 'US', {}).priceMissing).toBe(true);
  });
  it('rejects a queued buy that the wallet can no longer afford at the fill price', () => {
    let s = buy(fresh(), 'AAPL', 60, 150, false).state; // 9,000 reserved at 150
    const r = processTicks(s, { AAPL: tick(200) }, open, T0 + 5); // would cost 12,000
    s = r.state;
    expect(r.changed[0]).toMatchObject({ status: 'rejected' });
    expect(s.wallets.US.cash).toBe(10_000);
  });
});

describe('cancel, equity history and import checks', () => {
  it('cancels only open orders', () => {
    let s = placeOrder(fresh(), { symbol: 'AAPL', market: 'US', side: 'buy', type: 'limit', qty: 1, price: 50 }, tick(100), true, T0).state;
    const orderId = s.orders[0].id;
    s = cancelOrder(s, orderId, T0 + 1);
    expect(s.orders[0]).toMatchObject({ status: 'cancelled' });
    expect(cancelOrder(s, orderId).orders[0].status).toBe('cancelled');
  });
  it('records equity at most every 10 minutes unless forced', () => {
    let s = fresh();
    s = recordEquity(s, 'US', 10_100, T0 + 60_000);
    expect(s.equity.US).toHaveLength(1);
    s = recordEquity(s, 'US', 10_100, T0 + 11 * 60_000);
    expect(s.equity.US).toHaveLength(2);
    s = recordEquity(s, 'US', 10_200, T0 + 11 * 60_000 + 1, true);
    expect(s.equity.US).toHaveLength(3);
  });
  it('validates imported files', () => {
    const s = buy(fresh(), 'AAPL', 1, 100).state;
    expect(isPaperState(JSON.parse(JSON.stringify(s)))).toBe(true);
    expect(isPaperState({ ...s, version: 2 })).toBe(false);
    expect(isPaperState({ ...s, positions: [{ symbol: 'A', market: 'US', qty: 1.5, avgCost: 1 }] })).toBe(false);
    expect(isPaperState('nonsense')).toBe(false);
  });
});
