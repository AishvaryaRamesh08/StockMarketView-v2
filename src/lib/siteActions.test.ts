import { describe, expect, it, vi } from 'vitest';
import { createSiteActions, type ScreenState } from './siteActions.ts';

const cur: ScreenState = { symbol: 'AAPL', period: '1y', interval: '1d', overlays: ['sma50'], compare: ['MSFT', 'NVDA'], layout: 'multi', view: 'markets' };

describe('shared screen actions (command palette and Ask AI)', () => {
  it('apply the change and return it, so a later step can build on it', () => {
    const apply = vi.fn();
    const remember = vi.fn();
    const a = createSiteActions(apply, remember, 4);
    const patch = a.openChart(cur, 'MSFT', { period: '5y', layout: 'single' });
    expect(patch).toEqual({ symbol: 'MSFT', market: 'US', view: 'chart', compare: ['NVDA'], period: '5y', layout: 'single' });
    expect(apply).toHaveBeenCalledWith(patch);
    expect(remember).toHaveBeenCalledWith('MSFT');
  });
  it('add or remove an overlay only when it changes anything', () => {
    const a = createSiteActions(() => {}, () => {}, 4);
    expect(a.setOverlay(cur, 'rsi', true).overlays).toEqual(['sma50', 'rsi']);
    expect(a.setOverlay(cur, 'sma50', false).overlays).toEqual([]);
    expect(a.setOverlay(cur, 'sma50', true).overlays).toBeUndefined();
  });
  it('compare: no duplicates, never the stock itself, at most the limit', () => {
    const a = createSiteActions(() => {}, () => {}, 2);
    expect(a.setCompare(cur, ['TSLA', 'AAPL', 'TSLA', 'AMZN', 'META']).compare).toEqual(['TSLA', 'AMZN']);
  });
});
