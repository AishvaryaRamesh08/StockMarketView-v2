import type { IntervalId, PeriodId } from './ranges.ts';

/** One pane of the multi-timeframe view. */
export interface Frame {
  period: PeriodId;
  interval: IntervalId;
}

/** Four panes, short to long: 15-minute, hourly, daily and weekly candles. */
export const DEFAULT_FRAMES: Frame[] = [
  { period: '5d', interval: '15m' },
  { period: '1mo', interval: '60m' },
  { period: '1y', interval: '1d' },
  { period: '5y', interval: '1wk' },
];

/** Saved layouts from before the fourth pane get the weekly pane added. */
export function upgradeFrames(frames: Frame[]): Frame[] {
  return frames.length >= DEFAULT_FRAMES.length ? frames.slice(0, DEFAULT_FRAMES.length) : [...frames, ...DEFAULT_FRAMES.slice(frames.length)];
}
