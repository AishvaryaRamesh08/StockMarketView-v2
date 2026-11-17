import { describe, expect, it } from 'vitest';
import { newPaperState, placeOrder, type PaperState } from './paper.ts';
import { fillsOf, inPeriod, pnlByDay, pnlByStock, realizedByStock, tradeStats, tradingDay, unrealizedByStock } from './paperStats.ts';

// 17 Nov 2026, 10:00 in New York; the next day starts 14 hours later.
const DAY1 = Date.parse('2026-11-17T15:00:00Z');
const DAY2 = Date.parse('2026-11-18T15:00:00Z');

function trade(s: PaperState, symbol: string, side: 'buy' | 'sell', qty: number, price: number, at: number) {
  return placeOrder(s, { symbol, market: 'US', side, type: 'market', qty }, { price, time: at }, true, at).state;
}

function sample() {
  let s = newPaperState({ IN: 100_000, US: 100_000 }, DAY1 - 1000);
  s = trade(s, 'AAPL', 'buy', 10, 100, DAY1);
  s = trade(s, 'AAPL', 'buy', 10, 120, DAY1 + 60_000); // avg 110
  s = trade(s, 'AAPL', 'sell', 5, 130, DAY1 + 120_000); // +100
  s = trade(s, 'MSFT', 'buy', 4, 50, DAY1 + 180_000);
  s = trade(s, 'MSFT', 'sell', 4, 40, DAY1 + 240_000); // −40, closed same day
  s = trade(s, 'AAPL', 'sell', 15, 100, DAY2); // −150
  return s;
}

describe('fillsOf', () => {
  it('books each sale against the average cost, matching the wallet', () => {
    const s = sample();
    const fills = fillsOf(s, 'US');
    expect(fills.map((f) => f.realized ?? null)).toEqual([null, null, 100, null, -40, -150]);
    expect(fills.reduce((a, f) => a + (f.realized ?? 0), 0)).toBeCloseTo(s.wallets.US.realized, 8);
  });
  it('ignores the other wallet and unfilled orders', () => {
    let s = sample();
    s = placeOrder(s, { symbol: 'TSLA', market: 'US', side: 'buy', type: 'limit', qty: 1, price: 1 }, { price: 300, time: DAY2 }, true, DAY2).state;
    expect(fillsOf(s, 'US')).toHaveLength(6);
    expect(fillsOf(s, 'IN')).toHaveLength(0);
  });
});

describe('periods and days', () => {
  it("uses the exchange's own calendar day", () => {
    expect(tradingDay(Date.parse('2026-11-18T03:00:00Z'), 'US')).toBe('2026-11-17');
    expect(tradingDay(Date.parse('2026-11-18T03:00:00Z'), 'IN')).toBe('2026-11-18');
  });
  it('filters to today, and groups by day newest first', () => {
    const fills = fillsOf(sample(), 'US');
    expect(inPeriod(fills, 'today', 'US', DAY2 + 1000)).toHaveLength(1);
    const days = pnlByDay(fills, 'US');
    expect(days.map((d) => d.day)).toEqual(['2026-11-18', '2026-11-17']);
    expect(days[1]).toMatchObject({ invested: 2400, proceeds: 810, realized: 60, trades: 5, symbols: ['AAPL', 'MSFT'] });
  });
});

describe('per-stock P&L', () => {
  it('shows what was invested, received and gained for each stock', () => {
    const rows = pnlByStock(fillsOf(sample(), 'US'));
    const aapl = rows.find((r) => r.symbol === 'AAPL')!;
    expect(aapl).toMatchObject({ boughtQty: 20, invested: 2200, soldQty: 20, proceeds: 2150, realized: -50, trades: 4 });
    expect(aapl.realizedPct).toBeCloseTo((-50 / 2200) * 100, 8);
    const msft = rows.find((r) => r.symbol === 'MSFT')!;
    expect(msft).toMatchObject({ invested: 200, proceeds: 160, realized: -40, realizedPct: -20 });
  });
  it('splits realised P&L into winners and losers by stock', () => {
    expect(realizedByStock(fillsOf(sample(), 'US')).map((c) => [c.symbol, c.pnl])).toEqual([
      ['MSFT', -40],
      ['AAPL', -50],
    ]);
  });
  it('values holdings at the latest price, and flags ones without a price', () => {
    const c = unrealizedByStock(
      [
        { symbol: 'A', market: 'US', qty: 10, avgCost: 10 },
        { symbol: 'B', market: 'US', qty: 5, avgCost: 20 },
        { symbol: 'C', market: 'US', qty: 1, avgCost: 5 },
      ],
      { A: 12, B: 18 },
    );
    expect(c.map((x) => [x.symbol, x.pnl])).toEqual([
      ['A', 20],
      ['C', 0],
      ['B', -10],
    ]);
    expect(c.find((x) => x.symbol === 'C')!.priced).toBe(false);
  });
});

describe('tradeStats', () => {
  it('counts wins and losses and finds the best and worst sale', () => {
    const t = tradeStats(fillsOf(sample(), 'US'));
    expect(t).toMatchObject({ sales: 3, wins: 1, losses: 2, invested: 2400, proceeds: 2310, realized: -90 });
    expect(t.winRate).toBeCloseTo(100 / 3, 8);
    expect(t.best?.realized).toBe(100);
    expect(t.worst?.realized).toBe(-150);
  });
  it('has no win rate without sales', () => {
    expect(tradeStats([]).winRate).toBeNull();
  });
});

describe('portfolioSnapshot', () => {
  it('gives Ask AI the facts: weights, sectors, gains, losses and trade results', async () => {
    const { portfolioSnapshot } = await import('./paperStats.ts');
    let s = sample();
    s = trade(s, 'NVDA', 'buy', 10, 200, DAY2 + 1000);
    const snap = portfolioSnapshot(s, 'US', { NVDA: 180 }, { NVDA: { name: 'NVIDIA', sector: 'Information Technology', changePct: -1.234 } });
    expect(snap.holdings).toHaveLength(1);
    expect(snap.holdings[0]).toMatchObject({ symbol: 'NVDA', sector: 'Information Technology', qty: 10, avgCost: 200, lastPrice: 180, value: 1800, unrealizedPnl: -200, unrealizedPct: -10, todayChangePct: -1.23 });
    expect(snap.accountValue).toBeCloseTo(s.wallets.US.cash + 1800, 2);
    expect(snap.holdings[0].weightPct).toBeCloseTo((1800 / snap.accountValue) * 100, 1);
    expect(snap.sectorWeightsPct[0].sector).toBe('Information Technology');
    expect(snap.trades).toMatchObject({ sales: 3, wins: 1, losses: 2, winRatePct: 33 });
    expect(snap.realizedByStock.map((r) => r.symbol)).toEqual(['MSFT', 'AAPL']);
    expect(snap.simulated).toBe(true);
  });
});
