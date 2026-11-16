import { describe, expect, it } from 'vitest';
import { detectAt, detectPatterns } from './patterns.ts';
import type { Candle } from './types.ts';

let t = 0;
const bar = (o: number, h: number, l: number, c: number): Candle => ({ t: (t += 86400), o, h, l, c, v: 1000 });

/** Five steady down bars (body 2 each), so a following bar sees a prior decline. */
const decline = () => [bar(120, 121, 117.5, 118), bar(118, 119, 115.5, 116), bar(116, 117, 113.5, 114), bar(114, 115, 111.5, 112), bar(112, 113, 109.5, 110)];
const rise = () => [bar(100, 102.5, 99, 102), bar(102, 104.5, 101, 104), bar(104, 106.5, 103, 106), bar(106, 108.5, 105, 108), bar(108, 110.5, 107, 110)];
const last = (cs: Candle[]) => detectAt(cs, cs.length - 1);

describe('engulfing', () => {
  it('finds a bullish engulfing: green body covers the previous red body', () => {
    expect(last([...decline(), bar(108, 108.5, 104, 104.5), bar(104, 109.5, 103.5, 109)])).toContain('bullishEngulfing');
  });
  it('finds a bearish engulfing: red body covers the previous green body', () => {
    expect(last([...rise(), bar(110, 114, 109.5, 113.5), bar(114, 114.5, 108.5, 109)])).toContain('bearishEngulfing');
  });
  it('rejects a green bar that does not cover the previous body', () => {
    expect(last([...decline(), bar(108, 108.5, 104, 104.5), bar(105, 107.5, 104.5, 107)])).not.toContain('bullishEngulfing');
  });
});

describe('hammer and shooting star', () => {
  // Body 1.0 on a 5.6 range: big enough not to be a doji, lower shadow 4.5.
  it('finds a hammer after a decline', () => {
    expect(last([...decline(), bar(108.5, 109.6, 104, 109.5)])).toContain('hammer');
  });
  it('does not call the same shape a hammer after a rise', () => {
    expect(last([...rise(), bar(108.5, 109.6, 104, 109.5)])).not.toContain('hammer');
  });
  it('finds a shooting star after a rise', () => {
    expect(last([...rise(), bar(111.5, 116, 110, 110.5)])).toContain('shootingStar');
  });
});

describe('doji', () => {
  it('finds a bar whose open and close are nearly equal', () => {
    expect(last([...rise(), bar(110, 113, 107, 110.1)])).toContain('doji');
  });
  it('does not report hammer or shooting star on a doji', () => {
    const hits = last([...decline(), bar(109, 109.1, 104, 109.05)]);
    expect(hits).toContain('doji');
    expect(hits).not.toContain('hammer');
  });
});

describe('stars', () => {
  it('finds a morning star', () => {
    const cs = [...decline(), bar(110, 110.5, 105.5, 106), bar(105, 105.6, 104, 104.7), bar(105, 109.5, 104.8, 109)];
    expect(last(cs)).toContain('morningStar');
  });
  it('finds an evening star', () => {
    const cs = [...rise(), bar(110, 114.5, 109.5, 114), bar(115, 116, 114.6, 115.3), bar(115, 115.2, 110.5, 111)];
    expect(last(cs)).toContain('eveningStar');
  });
});

describe('harami', () => {
  it('finds a bullish harami: small green inside a long red body', () => {
    expect(last([...decline(), bar(110, 110.5, 101.5, 102), bar(104, 106, 103.5, 105.5)])).toContain('bullishHarami');
  });
  it('finds a bearish harami: small red inside a long green body', () => {
    expect(last([...rise(), bar(110, 118.5, 109.5, 118), bar(116, 116.5, 113.5, 114)])).toContain('bearishHarami');
  });
});

describe('detectPatterns', () => {
  it('filters to the requested patterns and records bias', () => {
    const cs = [...decline(), bar(108, 108.5, 104, 104.5), bar(104, 109.5, 103.5, 109)];
    const hits = detectPatterns(cs, new Set(['bullishEngulfing'] as const));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ index: cs.length - 1, pattern: 'bullishEngulfing', bias: 'bullish' });
  });
});
