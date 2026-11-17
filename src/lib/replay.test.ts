import { describe, expect, it } from 'vitest';
import { buyIn, equityOf, newAccount, replayRange, replayStart, sellOut, type ReplayAccount } from './replay.ts';
import { unsupportedReason, INTERVALS } from './ranges.ts';

describe('replay setup', () => {
  it('loads a range the data source can serve for every interval', () => {
    for (const i of INTERVALS) expect(unsupportedReason(replayRange(i.id), i.id)).toBeNull();
  });
  it('starts about a year back on daily candles, keeping history before it', () => {
    expect(replayStart(2500, '1d')).toBe(2249);
    expect(replayStart(100, '1d')).toBe(60);
    expect(replayStart(3, '1d')).toBe(1);
  });
});

describe('practice account', () => {
  const ok = (r: ReplayAccount | string) => {
    if (typeof r === 'string') throw new Error(r);
    return r;
  };
  it('buys and sells whole shares at the close, booking P&L on the average cost', () => {
    let a = newAccount('US');
    a = ok(buyIn(a, 10, 100, 1));
    a = ok(buyIn(a, 10, 120, 2));
    expect(a).toMatchObject({ qty: 20, avg: 110, cash: 10_000 - 2_200 });
    a = ok(sellOut(a, 5, 130, 3));
    expect(a.realized).toBe(100);
    expect(a.trades[2]).toMatchObject({ side: 'sell', realized: 100 });
    expect(equityOf(a, 130)).toBe(10_000 - 2_200 + 650 + 15 * 130);
  });
  it('refuses what the account cannot do', () => {
    const a = newAccount('US');
    expect(buyIn(a, 1000, 100, 1)).toMatch(/Not enough practice cash \(max 100\)/);
    expect(buyIn(a, 1.5, 10, 1)).toMatch(/whole number/);
    expect(sellOut(a, 1, 10, 1)).toMatch(/Nothing to sell/);
  });
});
