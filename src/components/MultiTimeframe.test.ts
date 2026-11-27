import { describe, expect, it } from 'vitest';
import { panePollMs } from './MultiTimeframe.tsx';
import { DEFAULT_FRAMES, upgradeFrames } from '../lib/frames.ts';
import { INTERVALS } from '../lib/ranges.ts';

describe('multi-timeframe request budget', () => {
  it('keeps four panes at or under 3 chart requests a minute, whatever their intervals', () => {
    const perMinute = (ms: number) => 60_000 / ms;
    const worst = 4 * Math.max(...INTERVALS.map((i) => perMinute(panePollMs(i.id))));
    expect(worst).toBeLessThanOrEqual(3);
    // Default frames (15m, 1h, daily, weekly): 1.9 a minute.
    expect(DEFAULT_FRAMES.reduce((a, f) => a + perMinute(panePollMs(f.interval)), 0)).toBeCloseTo(1.9, 5);
  });
  it('gives layouts saved with three panes the weekly fourth pane', () => {
    expect(upgradeFrames(DEFAULT_FRAMES.slice(0, 3))).toEqual(DEFAULT_FRAMES);
  });
});
