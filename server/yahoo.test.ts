import { describe, expect, it } from 'vitest';
import { parseSparkCloses, yahooPath, type YahooSparkResponse } from './yahoo.ts';

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

describe('parseSearchSymbols', () => {
  it('keeps listings on the exchanges this site covers, as search-index rows', async () => {
    const { parseSearchSymbols } = await import('./yahoo.ts');
    // Trimmed from the real /v1/finance/search?q=anthropic response, 20 Nov 2026.
    const res = {
      quotes: [
        { symbol: 'ANT', shortname: 'Anthropic, PBC', longname: 'Anthropic, PBC Class A Common Stock', exchange: 'NMS', quoteType: 'EQUITY' },
        { symbol: 'ANTW', shortname: 'Anthropic AI Lab Ecosystem ETF', exchange: 'PCX', quoteType: 'ETF' },
        { symbol: 'ANTHROPIC-USD', shortname: 'Anthropic tokenized stock (PreStocks) USD', exchange: 'CCC', quoteType: 'CRYPTOCURRENCY' },
        { symbol: 'ANTHZZX', shortname: 'Anthropic - Company Level', exchange: 'NAS', quoteType: 'MUTUALFUND' },
        { symbol: 'ANT.SW', shortname: 'Anthropic, PBC', exchange: 'EBS', quoteType: 'EQUITY' },
        { symbol: 'RELIANCE.NS', shortname: 'RELIANCE INDUSTRIES', longname: 'Reliance Industries Limited', exchange: 'NSI', quoteType: 'EQUITY' },
      ],
    };
    expect(parseSearchSymbols(res)).toEqual([
      ['ANT', 'Anthropic, PBC', 'NASDAQ', 's'],
      ['ANTW', 'Anthropic AI Lab Ecosystem ETF', 'NYSE Arca', 'e'],
      ['RELIANCE.NS', 'Reliance Industries Limited', 'NSE', 's'],
    ]);
  });
});

describe('yahooPath.chart', () => {
  it('asks for Max as a dated window, because range=max ignores the interval', () => {
    const now = Date.UTC(2026, 10, 21);
    expect(yahooPath.chart('AAPL', 'max', '1d', false, now)).toBe(`/v8/finance/chart/AAPL?period1=-2208988800&period2=${now / 1000 + 86400}&interval=1d&includePrePost=false`);
    expect(yahooPath.chart('AAPL', '10y', '1d')).toBe('/v8/finance/chart/AAPL?range=10y&interval=1d&includePrePost=false');
  });
});
