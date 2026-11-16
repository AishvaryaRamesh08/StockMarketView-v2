import type { ChartResponse, QuotesResponse } from './types.ts';
import type { IntervalId, PeriodId } from './ranges.ts';

export class ApiFailure extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiFailure(0, 'You appear to be offline. Retrying shortly.');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiFailure(res.status, body.error ?? `Request failed (${res.status})`);
  return body;
}

export function fetchChart(symbol: string, period: PeriodId, interval: IntervalId, signal?: AbortSignal): Promise<ChartResponse> {
  const q = new URLSearchParams({ symbol, range: period, interval });
  return getJson<ChartResponse>(`/api/chart?${q}`, signal);
}

export function fetchQuotes(symbols: string[], signal?: AbortSignal): Promise<QuotesResponse> {
  const q = new URLSearchParams({ symbols: symbols.join(',') });
  return getJson<QuotesResponse>(`/api/quotes?${q}`, signal);
}
