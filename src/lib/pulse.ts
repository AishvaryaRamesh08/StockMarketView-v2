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

export interface SectorSummary {
  name: string;
  /** Market-cap-weighted % change (equal-weighted when caps are missing). */
  chg: number;
  cap: number;
  stocks: PulseStock[];
}

export function sectors(stocks: PulseStock[]): SectorSummary[] {
  const groups = new Map<string, PulseStock[]>();
  for (const s of stocks) groups.set(s.sec || 'Other', [...(groups.get(s.sec || 'Other') ?? []), s]);
  return [...groups.entries()]
    .map(([name, list]) => {
      const capSum = list.reduce((a, s) => a + (s.cap ?? 0), 0);
      const chg = capSum > 0 ? list.reduce((a, s) => a + s.chg * (s.cap ?? 0), 0) / capSum : list.reduce((a, s) => a + s.chg, 0) / list.length;
      return { name, chg, cap: capSum || list.length, stocks: list };
    })
    .sort((a, b) => b.cap - a.cap);
}

export interface HeatScheme {
  neutral: number[];
  up: number[];
  down: number[];
}

export const DEFAULT_HEAT: HeatScheme = { neutral: [52, 58, 72], up: [22, 160, 112], down: [214, 64, 69] };

/** "22, 160, 112" (a CSS variable's value) → [22, 160, 112]. */
export function parseRgbTriple(value: string, fallback: number[]): number[] {
  const parts = value.split(',').map((x) => Number(x.trim()));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : fallback;
}

/** Tile colour for a % change: down ↔ neutral ↔ up, saturating at ±3%. */
export function changeColor(chg: number, scheme: HeatScheme = DEFAULT_HEAT): string {
  const t = Math.max(-1, Math.min(1, chg / 3));
  const neutral = scheme.neutral;
  const target = t >= 0 ? scheme.up : scheme.down;
  const k = Math.abs(t) ** 0.8;
  const c = neutral.map((n, i) => Math.round(n + (target[i] - n) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
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
