/**
 * Chart drawings: the data model, the time-axis maths that keeps them anchored when the
 * interval changes, hit-testing geometry, and undo/redo history. Pure functions only; the
 * canvas and pointer handling live in src/components/drawingController.ts.
 *
 * A drawing is stored as real prices and real Unix times, never pixels, so it stays on the same
 * candles whatever the zoom, window size, period or interval.
 */

export type DrawTool = 'trend' | 'hline' | 'rect' | 'fib' | 'text';

export interface DrawPoint {
  /** Unix seconds (real time, not the chart's exchange-shifted time). */
  t: number;
  /** Price. */
  p: number;
}

export interface Drawing {
  id: string;
  tool: DrawTool;
  a: DrawPoint;
  /** Second anchor for trendline, rectangle and Fibonacci. */
  b?: DrawPoint;
  /** For text notes. */
  text?: string;
}

export const TWO_POINT_TOOLS: ReadonlySet<DrawTool> = new Set(['trend', 'rect', 'fib']);

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Fibonacci retracement prices between the two anchors: level 0 at `b`, level 1 at `a`. */
export function fibPrices(a: number, b: number): Array<{ level: number; price: number }> {
  return FIB_LEVELS.map((level) => ({ level, price: b + (a - b) * level }));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* ------------------------------ time-axis maths ------------------------------ */

/** Typical spacing between bars, used to place points beyond the first or last candle. */
export function medianStep(times: number[]): number {
  if (times.length < 2) return 86400;
  const diffs: number[] = [];
  for (let i = Math.max(1, times.length - 50); i < times.length; i++) diffs.push(times[i] - times[i - 1]);
  diffs.sort((x, y) => x - y);
  return diffs[Math.floor(diffs.length / 2)] || 86400;
}

/**
 * Position of time `t` on the bar axis as a fractional index: 3.5 is halfway between bars 3
 * and 4. Bars are evenly spaced on screen even across nights and weekends, so interpolation
 * happens between neighbouring bars; outside the data it continues at the typical step.
 */
export function fracIndex(times: number[], t: number, step: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (t <= times[0]) return (t - times[0]) / step;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

/** Inverse of fracIndex. */
export function timeAtIndex(times: number[], f: number, step: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (f <= 0) return times[0] + f * step;
  if (f >= n - 1) return times[n - 1] + (f - (n - 1)) * step;
  const i = Math.floor(f);
  return times[i] + (f - i) * (times[i + 1] - times[i]);
}

/* --------------------------------- geometry --------------------------------- */

export interface Px {
  x: number;
  y: number;
}

export function distToSegment(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
}

export type HitPart = 'a' | 'b' | 'body';

/** A drawing's on-screen shape, as produced by the controller for the current zoom. */
export interface Shape {
  tool: DrawTool;
  a: Px;
  b?: Px;
  /** Chart width, for horizontal levels that span it. */
  width: number;
  /** Text box size, for text notes. */
  box?: { w: number; h: number };
  /** Y positions of Fibonacci levels. */
  fibYs?: number[];
}

/** Which part of a shape is under the pointer, if any. Handles win over the body. */
export function hitTest(s: Shape, p: Px, tol = 7): HitPart | null {
  const near = (q: Px) => Math.hypot(p.x - q.x, p.y - q.y) <= tol + 2;
  if (s.tool === 'hline') return Math.abs(p.y - s.a.y) <= tol ? 'body' : null;
  if (s.tool === 'text') {
    const w = s.box?.w ?? 60;
    const h = s.box?.h ?? 20;
    return p.x >= s.a.x - 2 && p.x <= s.a.x + w + 2 && p.y >= s.a.y - h / 2 - 2 && p.y <= s.a.y + h / 2 + 2 ? 'body' : null;
  }
  if (!s.b) return null;
  if (near(s.a)) return 'a';
  if (near(s.b)) return 'b';
  if (s.tool === 'trend') return distToSegment(p, s.a, s.b) <= tol ? 'body' : null;
  const x0 = Math.min(s.a.x, s.b.x);
  const x1 = Math.max(s.a.x, s.b.x);
  const y0 = Math.min(s.a.y, s.b.y);
  const y1 = Math.max(s.a.y, s.b.y);
  if (s.tool === 'rect') {
    // Anywhere inside: rectangles are filled, so people grab them by the middle.
    return p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol ? 'body' : null;
  }
  // Fibonacci: on any level line within its horizontal extent.
  if (p.x < x0 - tol || p.x > x1 + tol) return null;
  return (s.fibYs ?? [s.a.y, s.b.y]).some((y) => Math.abs(p.y - y) <= tol) ? 'body' : null;
}

/* --------------------------------- history --------------------------------- */

export interface History {
  past: Drawing[][];
  present: Drawing[];
  future: Drawing[][];
}

const MAX_HISTORY = 100;

export function historyOf(present: Drawing[]): History {
  return { past: [], present, future: [] };
}

export function commit(h: History, next: Drawing[]): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/* --------------------------------- storage --------------------------------- */

export function isDrawing(v: unknown): v is Drawing {
  const d = v as Drawing;
  const pt = (q: unknown): q is DrawPoint => !!q && Number.isFinite((q as DrawPoint).t) && Number.isFinite((q as DrawPoint).p);
  return !!d && typeof d.id === 'string' && ['trend', 'hline', 'rect', 'fib', 'text'].includes(d.tool) && pt(d.a) && (d.b === undefined || pt(d.b)) && (d.text === undefined || typeof d.text === 'string');
}

export const TOOL_LABEL: Record<DrawTool, string> = {
  trend: 'Trendline',
  hline: 'Horizontal level',
  rect: 'Rectangle',
  fib: 'Fibonacci retracement',
  text: 'Text note',
};
