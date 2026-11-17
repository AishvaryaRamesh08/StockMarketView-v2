/** Derived views of a market pulse snapshot: movers, breadth, sectors and peers. */
import type { PulseStock, UniverseEntry } from './marketData.ts';

export function topMovers(stocks: PulseStock[], n = 8) {
  const traded = stocks.filter((s) => s.v > 0);
  return {
    gainers: [...traded].sort((a, b) => b.chg - a.chg).slice(0, n),
    losers: [...traded].sort((a, b) => a.chg - b.chg).slice(0, n),
    // "Most active" by value traded, not share count: a ₹10 stock trades far more shares than a ₹10,000 one.
    active: [...traded].sort((a, b) => b.t - a.t).slice(0, n),
  };
}

export function breadth(stocks: PulseStock[]): { up: number; down: number; flat: number } {
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const s of stocks) {
    if (s.chg > 0.005) up++;
    else if (s.chg < -0.005) down++;
    else flat++;
  }
  return { up, down, flat };
}

/**
 * Peers of `symbol` within its index: same industry first, then same sector, largest first.
 * BSE symbols are matched through their NSE twin (TCS.BO → TCS.NS).
 */
export function findPeers(symbol: string, universe: UniverseEntry[], n = 6): UniverseEntry[] {
  const key = symbol.replace(/\.BO$/, '.NS');
  const self = universe.find((e) => e.s === key);
  if (!self) return [];
  const others = universe.filter((e) => e.s !== key);
  const byCap = (a: UniverseEntry, b: UniverseEntry) => (b.cap ?? 0) - (a.cap ?? 0);
  const sameInd = self.ind ? others.filter((e) => e.ind === self.ind).sort(byCap) : [];
  const sameSec = others.filter((e) => e.sec === self.sec && !sameInd.includes(e)).sort(byCap);
  return [...sameInd, ...sameSec].slice(0, n);
}
