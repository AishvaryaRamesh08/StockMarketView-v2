/**
 * Period and interval chips, and which combinations the data source can serve.
 * Yahoo limits: 1m bars cover ~7 days, 2m–30m ~60 days, 1h ~730 days.
 */

export const PERIODS = [
  { id: '1d', label: '1D', days: 1 },
  { id: '5d', label: '5D', days: 5 },
  { id: '1mo', label: '1M', days: 31 },
  { id: '3mo', label: '3M', days: 92 },
  { id: '6mo', label: '6M', days: 183 },
  { id: 'ytd', label: 'YTD', days: 366 },
  { id: '1y', label: '1Y', days: 366 },
  { id: '5y', label: '5Y', days: 1830 },
  { id: '10y', label: '10Y', days: 3660 },
  { id: 'max', label: 'Max', days: Infinity },
] as const;

export const INTERVALS = [
  { id: '1m', label: '1m', seconds: 60 },
  { id: '2m', label: '2m', seconds: 120 },
  { id: '5m', label: '5m', seconds: 300 },
  { id: '15m', label: '15m', seconds: 900 },
  { id: '30m', label: '30m', seconds: 1800 },
  { id: '60m', label: '1h', seconds: 3600 },
  { id: '1d', label: 'D', seconds: 86400 },
  { id: '1wk', label: 'W', seconds: 604800 },
  { id: '1mo', label: 'M', seconds: 2592000 },
] as const;

export type PeriodId = (typeof PERIODS)[number]['id'];
export type IntervalId = (typeof INTERVALS)[number]['id'];

/** Longest period (in days) each interval can cover, and the shortest that still makes a useful chart. */
const LIMITS: Record<IntervalId, { maxDays: number; minDays: number; reason: string }> = {
  '1m': { maxDays: 7, minDays: 0, reason: '1-minute data only covers the last 5 trading days' },
  '2m': { maxDays: 60, minDays: 0, reason: '2-minute data only covers the last month' },
  '5m': { maxDays: 60, minDays: 0, reason: '5-minute data only covers the last month' },
  '15m': { maxDays: 60, minDays: 0, reason: '15-minute data only covers the last month' },
  '30m': { maxDays: 60, minDays: 0, reason: '30-minute data only covers the last month' },
  '60m': { maxDays: 730, minDays: 0, reason: 'Hourly data only covers the last year' },
  '1d': { maxDays: Infinity, minDays: 5, reason: 'Pick 5D or longer for daily candles' },
  '1wk': { maxDays: Infinity, minDays: 92, reason: 'Pick 3M or longer for weekly candles' },
  '1mo': { maxDays: Infinity, minDays: 366, reason: 'Pick 1Y or longer for monthly candles' },
};

const DEFAULT_INTERVAL: Record<PeriodId, IntervalId> = {
  '1d': '5m',
  '5d': '15m',
  '1mo': '60m',
  '3mo': '1d',
  '6mo': '1d',
  ytd: '1d',
  '1y': '1d',
  '5y': '1wk',
  '10y': '1wk',
  max: '1mo',
};

/** Calendar days a period covers. YTD depends on today's date (short in January, long in December). */
function periodDays(period: PeriodId, now: Date = new Date()): number {
  if (period === 'ytd') return Math.max(1, Math.ceil((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400_000));
  return PERIODS.find((p) => p.id === period)!.days;
}

/** null when the combination works, otherwise a human-readable reason. */
export function unsupportedReason(period: PeriodId, interval: IntervalId, now: Date = new Date()): string | null {
  const days = periodDays(period, now);
  const limit = LIMITS[interval];
  if (days > limit.maxDays || days < limit.minDays) return limit.reason;
  return null;
}

export function defaultInterval(period: PeriodId): IntervalId {
  return DEFAULT_INTERVAL[period];
}

/** Keep the user's interval when it still works for the new period, otherwise use the period's default. */
export function intervalForPeriod(period: PeriodId, current: IntervalId): IntervalId {
  return unsupportedReason(period, current) ? defaultInterval(period) : current;
}

/** Smallest period that still works when the user picks an interval the current period can't serve. */
export function periodForInterval(interval: IntervalId, current: PeriodId): PeriodId {
  if (!unsupportedReason(current, interval)) return current;
  const ok = PERIODS.filter((p) => !unsupportedReason(p.id, interval)).map((p) => ({ id: p.id, days: periodDays(p.id) }));
  // Prefer the closest valid period to what the user had.
  const days = periodDays(current);
  return ok.reduce((best, p) => (Math.abs(p.days - days) < Math.abs(best.days - days) ? p : best)).id;
}

export function isIntraday(interval: IntervalId): boolean {
  return INTERVALS.find((i) => i.id === interval)!.seconds < 86400;
}

/**
 * The small range polled every 30 seconds to refresh the latest candles, instead of
 * downloading the whole history again.
 */
export function pollRange(interval: IntervalId): PeriodId {
  if (isIntraday(interval)) return '1d';
  if (interval === '1d') return '5d';
  if (interval === '1wk') return '1mo';
  return '3mo';
}

export function isPeriodId(v: unknown): v is PeriodId {
  return PERIODS.some((p) => p.id === v);
}

export function isIntervalId(v: unknown): v is IntervalId {
  return INTERVALS.some((i) => i.id === v);
}

/* ------------------------------ scroll-back steps ------------------------------ */

const STEP_ORDER: PeriodId[] = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', '10y', 'max'];
/** Keep each step's chart under this many candles so it stays quick to draw. */
const MAX_STEP_BARS = 3000;

/** Rough candle count for a period and interval (trading hours and weekdays only). */
export function estimateBars(period: PeriodId, interval: IntervalId, now: Date = new Date()): number {
  const days = periodDays(period, now);
  if (!Number.isFinite(days)) return Infinity;
  const sec = INTERVALS.find((i) => i.id === interval)!.seconds;
  const tradingShare = sec < 86400 ? (5 / 7) * (6.5 / 24) : sec === 86400 ? 5 / 7 : 1;
  return Math.ceil(((days * 86400) / sec) * tradingShare);
}

/**
 * Where scrolling back past the first candle goes next: the next longer period, keeping the
 * interval when the data source still serves it at that length, otherwise the next coarser one
 * that does (1D at 5m → 5D at 5m → 1M at 5m → 3M hourly → … → 5Y daily → Max weekly).
 * null at Max, where there is nothing older to load.
 */
export function stepBack(period: PeriodId, interval: IntervalId, now: Date = new Date()): { period: PeriodId; interval: IntervalId } | null {
  const next = period === 'ytd' ? '1y' : STEP_ORDER[STEP_ORDER.indexOf(period) + 1];
  if (!next) return null;
  const from = INTERVALS.findIndex((i) => i.id === interval);
  const floor = next === 'max' ? INTERVALS.findIndex((i) => i.id === '1wk') : 0;
  for (const iv of INTERVALS.slice(Math.max(from, floor))) {
    if (unsupportedReason(next, iv.id, now)) continue;
    if (next !== 'max' && estimateBars(next, iv.id, now) > MAX_STEP_BARS) continue;
    return { period: next, interval: iv.id };
  }
  return { period: next, interval: defaultInterval(next) };
}

/**
 * True when the loaded candles already begin well after the period's start, so the stock's
 * history (its listing) has been reached and a longer period would bring nothing older.
 * Only judged for daily-or-longer periods: intraday data is cut by the source, not the listing.
 */
export function reachedListing(period: PeriodId, firstCandle: number, nowMs: number = Date.now()): boolean {
  if (period === 'max') return true;
  const days = periodDays(period, new Date(nowMs));
  if (days < 92) return false;
  return (nowMs / 1000 - firstCandle) / 86400 < days * 0.8;
}
