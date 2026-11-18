import type { IntervalId, PeriodId } from './ranges.ts';

/** One pane of the multi-timeframe view. */
export interface Frame {
  period: PeriodId;
  interval: IntervalId;
}

export const DEFAULT_FRAMES: Frame[] = [
  { period: '5d', interval: '15m' },
  { period: '1mo', interval: '60m' },
  { period: '1y', interval: '1d' },
];
