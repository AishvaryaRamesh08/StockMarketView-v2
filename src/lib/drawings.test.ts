import { describe, expect, it } from 'vitest';
import { commit, distToSegment, fibPrices, fracIndex, historyOf, hitTest, isDrawing, medianStep, redo, timeAtIndex, undo, type Drawing, type Shape } from './drawings.ts';

describe('time-axis maths', () => {
  // Daily bars Mon–Fri then the next Mon: the weekend gap is one bar wide on screen.
  const day = 86400;
  const times = [0, 1, 2, 3, 4, 7].map((d) => d * day);
  const step = medianStep(times);

  it('finds the typical bar spacing despite the weekend gap', () => {
    expect(step).toBe(day);
  });
  it('maps bar times to whole indices and back', () => {
    times.forEach((t, i) => {
      expect(fracIndex(times, t, step)).toBe(i);
      expect(timeAtIndex(times, i, step)).toBe(t);
    });
  });
  it('interpolates inside a gap by screen position, not clock time', () => {
    // Saturday noon is 1.5 of 3 days into the Fri→Mon gap: halfway between bars 4 and 5.
    expect(fracIndex(times, 5.5 * day, step)).toBeCloseTo(4.5, 10);
    expect(timeAtIndex(times, 4.5, step)).toBeCloseTo(5.5 * day, 6);
  });
  it('extends past both ends at the typical step', () => {
    expect(fracIndex(times, 9 * day, step)).toBe(7);
    expect(timeAtIndex(times, 7, step)).toBe(9 * day);
    expect(fracIndex(times, -2 * day, step)).toBe(-2);
    expect(timeAtIndex(times, -2, step)).toBe(-2 * day);
  });
  it('keeps an anchor on the same moment when the interval changes', () => {
    // A point placed on a daily bar lands inside that day on hourly bars.
    const hourly = Array.from({ length: 48 }, (_, i) => i * 3600);
    const f = fracIndex(hourly, day, 3600);
    expect(f).toBe(24);
    expect(timeAtIndex(hourly, f, 3600)).toBe(day);
  });
});

describe('fibPrices', () => {
  it('runs from the second anchor (0) to the first (1)', () => {
    const levels = fibPrices(200, 100);
    expect(levels[0]).toEqual({ level: 0, price: 100 });
    expect(levels.at(-1)).toEqual({ level: 1, price: 200 });
    expect(levels.find((l) => l.level === 0.5)!.price).toBe(150);
    expect(levels.find((l) => l.level === 0.618)!.price).toBeCloseTo(161.8, 10);
  });
});

describe('hit testing', () => {
  const trend: Shape = { tool: 'trend', a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, width: 500 };
  it('measures distance to a segment, clamped at its ends', () => {
    expect(distToSegment({ x: 50, y: 50 }, trend.a, trend.b!)).toBe(0);
    expect(distToSegment({ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
    expect(distToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
  });
  it('prefers handles over the body on a trendline', () => {
    expect(hitTest(trend, { x: 2, y: 1 })).toBe('a');
    expect(hitTest(trend, { x: 99, y: 98 })).toBe('b');
    expect(hitTest(trend, { x: 50, y: 53 })).toBe('body');
    expect(hitTest(trend, { x: 50, y: 80 })).toBeNull();
  });
  it('hits a horizontal level anywhere along the chart', () => {
    const h: Shape = { tool: 'hline', a: { x: 0, y: 40 }, width: 500 };
    expect(hitTest(h, { x: 480, y: 43 })).toBe('body');
    expect(hitTest(h, { x: 480, y: 60 })).toBeNull();
  });
  it('hits a rectangle anywhere inside it', () => {
    const r: Shape = { tool: 'rect', a: { x: 10, y: 10 }, b: { x: 110, y: 60 }, width: 500 };
    expect(hitTest(r, { x: 60, y: 35 })).toBe('body');
    expect(hitTest(r, { x: 200, y: 35 })).toBeNull();
    expect(hitTest(r, { x: 111, y: 61 })).toBe('b');
  });
  it('hits Fibonacci level lines only', () => {
    const f: Shape = { tool: 'fib', a: { x: 10, y: 0 }, b: { x: 110, y: 100 }, width: 500, fibYs: [0, 50, 100] };
    expect(hitTest(f, { x: 60, y: 51 })).toBe('body');
    expect(hitTest(f, { x: 60, y: 25 })).toBeNull();
  });
  it('hits a text note inside its box', () => {
    const t: Shape = { tool: 'text', a: { x: 100, y: 100 }, width: 500, box: { w: 80, h: 20 } };
    expect(hitTest(t, { x: 140, y: 104 })).toBe('body');
    expect(hitTest(t, { x: 200, y: 104 })).toBeNull();
  });
});

describe('history', () => {
  const d = (id: string): Drawing => ({ id, tool: 'hline', a: { t: 0, p: 1 } });
  it('undoes and redoes, and a new change clears redo', () => {
    let h = historyOf([]);
    h = commit(h, [d('1')]);
    h = commit(h, [d('1'), d('2')]);
    h = undo(h);
    expect(h.present.map((x) => x.id)).toEqual(['1']);
    h = redo(h);
    expect(h.present.map((x) => x.id)).toEqual(['1', '2']);
    h = undo(undo(h));
    expect(h.present).toEqual([]);
    expect(undo(h)).toBe(h);
    h = commit(h, [d('3')]);
    expect(redo(h)).toBe(h);
  });
});

describe('isDrawing', () => {
  it('accepts valid drawings and rejects damaged ones', () => {
    expect(isDrawing({ id: 'x', tool: 'trend', a: { t: 1, p: 2 }, b: { t: 3, p: 4 } })).toBe(true);
    expect(isDrawing({ id: 'x', tool: 'text', a: { t: 1, p: 2 }, text: 'hi' })).toBe(true);
    expect(isDrawing({ id: 'x', tool: 'circle', a: { t: 1, p: 2 } })).toBe(false);
    expect(isDrawing({ id: 'x', tool: 'trend', a: { t: 'no', p: 2 } })).toBe(false);
    expect(isDrawing(null)).toBe(false);
  });
});
