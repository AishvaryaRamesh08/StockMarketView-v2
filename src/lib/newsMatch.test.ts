import { describe, expect, it } from 'vitest';
import { buildMatchers, matchStocks } from './newsMatch.ts';

const stocks = [
  { s: 'NVDA', n: 'NVIDIA Corporation', cap: 4e12 },
  { s: 'CRM', n: 'Salesforce, Inc.', cap: 2e11 },
  { s: 'AAPL', n: 'Apple Inc.', cap: 3e12 },
  { s: 'TGT', n: 'Target Corporation', cap: 5e10 },
  { s: 'NOW', n: 'ServiceNow, Inc.', cap: 2e11 },
  { s: 'TATAMOTORS.NS', n: 'Tata Motors Limited', cap: 3e12 },
  { s: 'TATASTEEL.NS', n: 'Tata Steel Limited', cap: 2e12 },
  { s: 'AXISBANK.NS', n: 'Axis Bank Limited', cap: 3e12 },
  { s: 'TCS.NS', n: 'Tata Consultancy Services Limited', cap: 1.3e13 },
  { s: 'NDAQ', n: 'Nasdaq, Inc.', cap: 5e10 },
  { s: 'STT', n: 'State Street Corporation', cap: 3e10 },
];
const m = buildMatchers(stocks);
const find = (t: string) => matchStocks(t, m);

describe('matching headlines to stocks', () => {
  it('finds companies by their distinctive name, any capitalisation for all-caps names', () => {
    expect(find('Stock Market Today: Dow Drops As Salesforce Dives; Nvidia Falls')).toEqual(['NVDA', 'CRM']);
    expect(find('NVIDIA earnings loom')).toEqual(['NVDA']);
  });
  it('tells apart companies that share a first word', () => {
    expect(find('Tata Steel shares jump on Europe restructuring')).toEqual(['TATASTEEL.NS']);
    expect(find('Tata group stocks mixed')).toEqual([]);
  });
  it('matches tickers written in capitals, but not ones that are everyday words', () => {
    expect(find('TCS wins large deal')).toEqual(['TCS.NS']);
    expect(find('Stocks to buy NOW')).toEqual([]);
    expect(find('ServiceNow beats estimates')).toEqual(['NOW']);
  });
  it('does not read index or fund-family names as the companies behind them', () => {
    expect(find('Dow Plunges 700 Points as S&P 500 and Nasdaq Fall')).toEqual([]);
    expect(find('the State Street Energy Select Sector SPDR ETF fell')).toEqual([]);
  });
  it('avoids ordinary words and partial words', () => {
    expect(find('Analysts raise price target on chip makers')).toEqual([]);
    expect(find('an apple a day')).toEqual([]);
    expect(find('Nvidias are not a thing')).toEqual([]);
  });
  it('lists the largest company first and caps the list', () => {
    expect(find('BlackRock raises its stake in Axis Bank; TCS and Apple also in focus')).toEqual(['TCS.NS', 'AAPL', 'AXISBANK.NS']);
  });
});
