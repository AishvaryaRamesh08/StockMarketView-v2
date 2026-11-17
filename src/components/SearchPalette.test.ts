import { describe, expect, it } from 'vitest';
import { commandsFirst, matchActions, type PaletteAction } from './SearchPalette.tsx';

const a = (label: string, keywords = ''): PaletteAction => ({ id: label, label, keywords, run: () => {} });
const actions = [a('Switch to light theme', 'appearance mode'), a('Show RSI 14', 'indicator'), a('Show MACD (12, 26, 9)', 'indicator'), a('Go to Markets', 'heatmap')];
const labels = (q: string) => matchActions(actions, q).map((x) => x.label);

describe('matchActions', () => {
  it('matches on label and keywords, every word required', () => {
    expect(labels('light')).toEqual(['Switch to light theme']);
    expect(labels('show rsi')).toEqual(['Show RSI 14']);
    expect(labels('heatmap')).toEqual(['Go to Markets']);
    expect(labels('show heatmap')).toEqual([]);
  });
  it('offers nothing for an empty or one-letter query, so stock search stays clean', () => {
    expect(labels('')).toEqual([]);
    expect(labels('s')).toEqual([]);
  });
  it('lists every command after ">"', () => {
    expect(labels('>')).toHaveLength(4);
    expect(labels('> indicator')).toHaveLength(2);
  });
});

describe('commandsFirst', () => {
  it('puts commands first unless the query is exactly a ticker', () => {
    expect(commandsFirst([{ base: 'BLUEJET' }, { base: 'BLUEDART' }], 'blue')).toBe(true);
    expect(commandsFirst([{ base: 'TCS' }, { base: 'TCSX' }], 'tcs')).toBe(false);
    expect(commandsFirst([], 'dark theme')).toBe(true);
  });
});
