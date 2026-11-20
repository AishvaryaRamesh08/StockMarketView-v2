import type { ChartResponse, ClosesResponse, QuotesResponse, SymbolRow } from './types.ts';
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
  // A cancelled request can fail while reading the body: that must stay a cancellation, not
  // turn into an empty "successful" response.
  const body = (await res.json().catch((err: Error) => {
    if (err.name === 'AbortError') throw err;
    return {};
  })) as T & { error?: string };
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

/** Closing prices for up to 20 symbols in one request. */
export function fetchCloses(symbols: string[], period: PeriodId, interval: IntervalId, signal?: AbortSignal): Promise<ClosesResponse> {
  const q = new URLSearchParams({ symbols: symbols.join(','), range: period, interval });
  return getJson<ClosesResponse>(`/api/closes?${q}`, signal);
}

/** Yahoo's live ticker search, for listings newer than the bundled index. */
export function fetchSearch(query: string, signal?: AbortSignal): Promise<{ symbols: SymbolRow[] }> {
  return getJson<{ symbols: SymbolRow[] }>(`/api/search?${new URLSearchParams({ q: query })}`, signal);
}
