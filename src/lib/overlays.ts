/**
 * Everything a user can switch on above, on or below the chart, with the colours used to draw
 * it and a one-sentence beginner explanation shown on hover.
 */
import { PATTERN_BIAS, type PatternId } from './patterns.ts';

export type IndicatorId = 'sma20' | 'sma50' | 'sma100' | 'sma200' | 'ema9' | 'ema21' | 'bb' | 'ichimoku' | 'psar' | 'vwap' | 'rsi' | 'macd';
export type LevelId = 'lvl52w' | 'lvlPrev' | 'lvlSR';
export type EventId = 'dividends';
export type OverlayId = IndicatorId | PatternId | LevelId | EventId;

export type OverlayGroup = 'Moving averages' | 'Trend & volatility' | 'Oscillators (own panel)' | 'Candlestick patterns' | 'Key levels' | 'Events';

export interface OverlayDef {
  id: OverlayId;
  label: string;
  group: OverlayGroup;
  /** Swatch colour shown in the menu and legend. */
  color: string;
  info: string;
  /** Only meaningful on intraday candles. */
  intradayOnly?: boolean;
  /** Needs at least this many candles to say anything. */
  minBars?: number;
}

export const OVERLAYS: OverlayDef[] = [
  { id: 'sma20', label: 'SMA 20', group: 'Moving averages', color: '#f5c542', minBars: 20, info: 'Average closing price of the last 20 candles. Smooths out noise to show the short-term trend.' },
  { id: 'sma50', label: 'SMA 50', group: 'Moving averages', color: '#5b8cff', minBars: 50, info: 'Average of the last 50 closes, a common medium-term trend line. Price above it is generally read as an uptrend.' },
  { id: 'sma100', label: 'SMA 100', group: 'Moving averages', color: '#b37feb', minBars: 100, info: 'Average of the last 100 closes. Moves slowly and often acts as support or resistance.' },
  { id: 'sma200', label: 'SMA 200', group: 'Moving averages', color: '#ff9f43', minBars: 200, info: 'Average of the last 200 closes, the classic long-term trend line. When the 50 crosses above it, traders call it a "golden cross".' },
  { id: 'ema9', label: 'EMA 9', group: 'Moving averages', color: '#2dd4bf', minBars: 9, info: 'Exponential average of the last 9 closes. Gives more weight to recent prices, so it reacts faster than a simple average.' },
  { id: 'ema21', label: 'EMA 21', group: 'Moving averages', color: '#f472b6', minBars: 21, info: 'Exponential average of the last 21 closes, often paired with EMA 9: when the fast line crosses the slow one, momentum may be changing.' },

  { id: 'bb', label: 'Bollinger Bands', group: 'Trend & volatility', color: '#8b95a8', minBars: 20, info: 'A 20-candle average with bands two standard deviations above and below. Wide bands mean volatile prices; price near a band is stretched from its average.' },
  { id: 'ichimoku', label: 'Ichimoku Cloud', group: 'Trend & volatility', color: '#66bb6a', minBars: 52, info: 'A Japanese all-in-one trend system. The "cloud" (two lines projected 26 candles ahead) acts as support or resistance; price above a green cloud is bullish.' },
  { id: 'psar', label: 'Parabolic SAR', group: 'Trend & volatility', color: '#f0b429', minBars: 3, info: 'Dots that trail the price. Dots below price suggest an uptrend, dots above a downtrend; a flip is a possible trend change and is often used for stop-losses.' },
  { id: 'vwap', label: 'VWAP', group: 'Trend & volatility', color: '#e879f9', intradayOnly: true, info: "Volume-weighted average price for today's session: the average price paid per share. Day traders treat it as fair value; it only applies to intraday candles." },

  { id: 'rsi', label: 'RSI 14', group: 'Oscillators (own panel)', color: '#b37feb', minBars: 15, info: 'Relative Strength Index, from 0 to 100, measures how strong recent gains are versus losses. Above 70 is called overbought, below 30 oversold.' },
  { id: 'macd', label: 'MACD (12, 26, 9)', group: 'Oscillators (own panel)', color: '#5b8cff', minBars: 35, info: 'The gap between a fast and a slow average, plus a signal line. When MACD crosses above its signal line momentum is turning up; below, turning down.' },

  { id: 'bullishEngulfing', label: 'Bullish engulfing', group: 'Candlestick patterns', color: '#22c38e', info: "A green candle whose body completely covers the previous red candle's body. Buyers overpowered sellers; a possible bottom." },
  { id: 'bearishEngulfing', label: 'Bearish engulfing', group: 'Candlestick patterns', color: '#f2555a', info: "A red candle whose body completely covers the previous green candle's body. Sellers took control; a possible top." },
  { id: 'hammer', label: 'Hammer', group: 'Candlestick patterns', color: '#22c38e', info: 'After a decline: a small body at the top with a long lower wick. Sellers pushed price down but buyers pushed it back up.' },
  { id: 'shootingStar', label: 'Shooting star', group: 'Candlestick patterns', color: '#f2555a', info: 'After a rise: a small body at the bottom with a long upper wick. Buyers pushed price up but sellers drove it back down.' },
  { id: 'doji', label: 'Doji', group: 'Candlestick patterns', color: '#9aa4b5', info: 'Open and close almost equal: buyers and sellers ended in a draw. Signals indecision, and matters most after a strong move.' },
  { id: 'morningStar', label: 'Morning star', group: 'Candlestick patterns', color: '#22c38e', info: 'Three candles: a big red one, a small one, then a big green one. A classic bullish reversal at the end of a decline.' },
  { id: 'eveningStar', label: 'Evening star', group: 'Candlestick patterns', color: '#f2555a', info: 'Three candles: a big green one, a small one, then a big red one. A classic bearish reversal at the end of a rise.' },
  { id: 'bullishHarami', label: 'Bullish harami', group: 'Candlestick patterns', color: '#22c38e', info: 'A small green candle sitting inside the previous big red candle. The selling may be losing steam.' },
  { id: 'bearishHarami', label: 'Bearish harami', group: 'Candlestick patterns', color: '#f2555a', info: 'A small red candle sitting inside the previous big green candle. The buying may be losing steam.' },

  { id: 'lvl52w', label: '52-week high / low', group: 'Key levels', color: '#9aa4b5', info: 'The highest and lowest prices of the past year. Many traders watch for breakouts above the high or breakdowns below the low.' },
  { id: 'lvlPrev', label: 'Previous day high / low', group: 'Key levels', color: '#f0b429', info: "Yesterday's high and low. Intraday traders use them as the first levels price may react to." },
  { id: 'lvlSR', label: 'Support & resistance', group: 'Key levels', color: '#5b8cff', info: 'Prices where the chart has turned more than once. Support (green) is where buyers stepped in; resistance (red) is where sellers did. Detected automatically, so treat them as zones, not exact prices.' },

  { id: 'dividends', label: 'Dividends & splits', group: 'Events', color: '#9aa4b5', info: 'Marks the ex-dividend dates (D) and stock splits (S) in the visible period.' },
];

export const OVERLAY_BY_ID = new Map(OVERLAYS.map((o) => [o.id, o]));

export const DEFAULT_OVERLAYS: OverlayId[] = ['sma50', 'sma200', 'bullishEngulfing', 'bearishEngulfing', 'dividends'];

export const PATTERN_IDS = OVERLAYS.filter((o) => o.group === 'Candlestick patterns').map((o) => o.id as PatternId);

/** Menu/legend swatch: patterns follow the theme's up/down colours, indicators keep their own. */
export function swatchColor(o: OverlayDef): string {
  if (o.group !== 'Candlestick patterns') return o.color;
  const bias = PATTERN_BIAS[o.id as PatternId];
  return bias === 'bullish' ? 'var(--up)' : bias === 'bearish' ? 'var(--down)' : o.color;
}

export function isOverlayId(v: unknown): v is OverlayId {
  return typeof v === 'string' && OVERLAY_BY_ID.has(v as OverlayId);
}

/** Short names drawn next to pattern markers. */
export const PATTERN_SHORT: Record<PatternId, string> = {
  bullishEngulfing: 'Engulfing',
  bearishEngulfing: 'Engulfing',
  hammer: 'Hammer',
  shootingStar: 'Shooting star',
  doji: 'Doji',
  morningStar: 'Morning star',
  eveningStar: 'Evening star',
  bullishHarami: 'Harami',
  bearishHarami: 'Harami',
};
