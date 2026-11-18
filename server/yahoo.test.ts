import { describe, expect, it } from 'vitest';
import { parseSparkCloses, type YahooSparkResponse } from './yahoo.ts';

// Shape of a real /v7/finance/spark response (range=5d, interval=1d), trimmed to two symbols.
// RELIANCE.NS shows the NSE quirk: today's daily close comes back null.
const IST = 19800;
const day = (d: number) => Date.UTC(2026, 10, d, 3, 45) / 1000; // 09:15 IST session opens
const spark: YahooSparkResponse = {
  spark: {
    result: [
      {
        symbol: 'RELIANCE.NS',
        response: [
          {
            meta: { symbol: 'RELIANCE.NS', gmtoffset: IST, regularMarketPrice: 1371.5, regularMarketTime: day(18) + 3600 } as never,
            timestamp: [day(12), day(13), day(16), day(17), day(18)],
            indicators: { quote: [{ close: [1320, null, 1340, 1367, null] }] },
          },
        ],
      },
      {
        symbol: 'AAPL',
        response: [
          {
            meta: { symbol: 'AAPL', gmtoffset: -18000, regularMarketPrice: 351.9, regularMarketTime: Date.UTC(2026, 10, 17, 21, 0) / 1000 } as never,
            timestamp: [Date.UTC(2026, 10, 16, 14, 30) / 1000, Date.UTC(2026, 10, 17, 14, 30) / 1000],
            indicators: { quote: [{ close: [350.1, 351.9] }] },
          },
        ],
      },
    ],
  },
};

describe('parseSparkCloses', () => {
  it('returns [time, close] per symbol and skips the null-padded gaps', () => {
    const [rel, aapl] = parseSparkCloses(spark);
    expect(rel.symbol).toBe('RELIANCE.NS');
    expect(rel.closes).toEqual([
      [day(12), 1320],
      [day(16), 1340],
      [day(17), 1367],
    ]);
    expect(aapl.closes).toHaveLength(2);
  });

  it("adds today's point from the live price when an NSE daily close is missing", () => {
    const [rel, aapl] = parseSparkCloses(spark, true);
    expect(rel.closes[rel.closes.length - 1]).toEqual([day(18) + 3600, 1371.5]);
    // AAPL already has today's close: nothing is added.
    expect(aapl.closes).toHaveLength(2);
  });
});
