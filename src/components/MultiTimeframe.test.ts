import { describe, expect, it } from 'vitest';
import { panePollMs } from './MultiTimeframe.tsx';
import { DEFAULT_FRAMES } from '../lib/frames.ts';
import { INTERVALS } from '../lib/ranges.ts';

describe('multi-timeframe request budget', () => {
  it('keeps three panes at or under 3 chart requests a minute, whatever their intervals', () => {
    const perMinute = (ms: number) => 60_000 / ms;
    const worst = 3 * Math.max(...INTERVALS.map((i) => perMinute(panePollMs(i.id))));
    expect(worst).toBeLessThanOrEqual(3);
    // Default frames (15m, 1h, daily): 2.2 a minute.
    expect(DEFAULT_FRAMES.reduce((a, f) => a + perMinute(panePollMs(f.interval)), 0)).toBeCloseTo(2.2, 5);
  });
});
