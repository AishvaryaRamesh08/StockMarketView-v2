import { describe, expect, it } from 'vitest';
import { diffTail, mergeCandles } from './candles.ts';
import { foldLiveTick } from '../../server/api.ts';
import type { Candle } from './types.ts';

const bar = (t: number, c = 100, v = 10): Candle => ({ t, o: c, h: c + 1, l: c - 1, c, v });

describe('mergeCandles', () => {
  it('replaces the still-forming candle and appends new ones', () => {
    const history = [bar(1), bar(2), bar(3, 100)];
    const fresh = [bar(3, 105), bar(4, 106)];
    const merged = mergeCandles(history, fresh);
    expect(merged.map((c) => c.t)).toEqual([1, 2, 3, 4]);
    expect(merged[2].c).toBe(105);
  });
  it('replaces every bar from the start of the fresh range', () => {
    const merged = mergeCandles([bar(1), bar(2), bar(3), bar(4)], [bar(2, 50), bar(3, 51)]);
    expect(merged.map((c) => [c.t, c.c])).toEqual([[1, 100], [2, 50], [3, 51]]);
  });
  it('handles empty inputs', () => {
    expect(mergeCandles([], [bar(1)])).toEqual([bar(1)]);
    expect(mergeCandles([bar(1)], [])).toEqual([bar(1)]);
  });
  it('ignores a poll that starts before the history', () => {
    const history = [bar(5), bar(6)];
    expect(mergeCandles(history, [bar(1), bar(7)])).toBe(history);
  });
});

describe('diffTail', () => {
  it('updates only the tail when the last drawn bar is still present', () => {
    const prev = [bar(1), bar(2), bar(3)];
    const next = [bar(1), bar(2), bar(3, 101), bar(4)];
    expect(diffTail(prev, next)).toEqual({ kind: 'update', bars: [bar(3, 101), bar(4)] });
  });
  it('resets when history shrank or shifted', () => {
    expect(diffTail([bar(1), bar(2), bar(3)], [bar(1), bar(2)]).kind).toBe('reset');
    expect(diffTail([bar(1), bar(2), bar(3)], [bar(1), bar(2), bar(4)]).kind).toBe('reset');
    expect(diffTail([], [bar(1)]).kind).toBe('reset');
  });
});

describe('foldLiveTick', () => {
  it('folds an off-grid live tick into the bucket before it', () => {
    const candles = [bar(0), { t: 300, o: 100, h: 101, l: 99, c: 100, v: 10 }, { t: 420, o: 103, h: 103, l: 103, c: 103, v: 0 }];
    foldLiveTick(candles, '5m');
    expect(candles).toHaveLength(2);
    expect(candles[1]).toEqual({ t: 300, o: 100, h: 103, l: 99, c: 103, v: 10 });
  });
  it('leaves on-grid bars and daily data alone', () => {
    const intraday = [bar(0), bar(300), bar(600)];
    foldLiveTick(intraday, '5m');
    expect(intraday).toHaveLength(3);
    const daily = [bar(0), bar(100)];
    foldLiveTick(daily, '1d');
    expect(daily).toHaveLength(2);
  });
});
