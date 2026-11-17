import { useCallback, useEffect, useState } from 'react';
import type { PatternFeed, Pulse, UniverseEntry } from '../lib/marketData.ts';
import type { NewsResponse } from '../../server/news.ts';
import { marketStatus } from '../lib/markets.ts';
import type { MarketId } from '../lib/types.ts';
import { usePolling } from './usePolling.ts';
import { useNow } from './useNow.ts';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = (await res.json().catch((err: Error) => {
    if (err.name === 'AbortError') throw err;
    return {};
  })) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Live market snapshot, refreshed every 2 minutes while that market is open (10 minutes otherwise). */
export function usePulse(market: MarketId, enabled: boolean): { pulse: Pulse | null; error: string | null; lastUpdated: number | null } {
  const [state, setState] = useState<{ market: MarketId; pulse: Pulse | null; error: string | null; lastUpdated: number | null }>({ market, pulse: null, error: null, lastUpdated: null });

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const pulse = await getJson<Pulse>(`/api/pulse?market=${market}`, signal);
        setState({ market, pulse, error: null, lastUpdated: Date.now() });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setState((s) => ({ ...s, market, error: (err as Error).message }));
      }
    },
    [market],
  );

  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load, enabled]);

  const now = useNow(60_000);
  const open = marketStatus(market, new Date(now)).state === 'open';
  usePolling(load, open ? 2 * 60_000 : 10 * 60_000, enabled);

  return state.market === market ? state : { pulse: null, error: null, lastUpdated: null };
}

/** Candlestick patterns found by the scheduled scan of the latest session. */
export function usePatternFeed(market: MarketId, enabled: boolean): { feed: PatternFeed | null; error: string | null } {
  const [state, setState] = useState<{ market: MarketId; feed: PatternFeed | null; error: string | null }>({ market, feed: null, error: null });
  const tick = useNow(15 * 60_000);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    getJson<PatternFeed>(`/api/patterns?market=${market}`, c.signal)
      .then((feed) => setState({ market, feed, error: null }))
      .catch((err: Error) => err.name !== 'AbortError' && setState({ market, feed: null, error: err.message }));
    return () => c.abort();
  }, [market, enabled, tick]);
  return state.market === market ? state : { feed: null, error: null };
}

const universeCache = new Map<MarketId, Promise<UniverseEntry[]>>();

/** NIFTY 500 or S&P 500 constituents with sectors, loaded once per page. */
/** The index constituents (name, sector, market cap), fetched once per visit. */
export function loadUniverse(market: MarketId): Promise<UniverseEntry[]> {
  let p = universeCache.get(market);
  if (!p) {
    p = getJson<{ stocks: UniverseEntry[] }>(`/api/universe?market=${market}`).then((r) => r.stocks);
    p.catch(() => universeCache.delete(market));
    universeCache.set(market, p);
  }
  return p;
}

export function useUniverse(market: MarketId): UniverseEntry[] | null {
  const [list, setList] = useState<{ market: MarketId; stocks: UniverseEntry[] } | null>(null);
  useEffect(() => {
    const p = loadUniverse(market);
    let live = true;
    p.then((stocks) => live && setList({ market, stocks })).catch(() => {});
    return () => {
      live = false;
    };
  }, [market]);
  return list?.market === market ? list.stocks : null;
}

/** Latest market headlines, refreshed hourly (the server caches them for an hour too). */
export function useNews(market: MarketId, enabled: boolean): { news: NewsResponse | null; error: string | null; lastUpdated: number | null } {
  const [state, setState] = useState<{ market: MarketId; news: NewsResponse | null; error: string | null; lastUpdated: number | null }>({ market, news: null, error: null, lastUpdated: null });

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const news = await getJson<NewsResponse>(`/api/news?market=${market}`, signal);
        setState({ market, news, error: null, lastUpdated: Date.now() });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setState((s) => ({ ...s, market, error: (err as Error).message }));
      }
    },
    [market],
  );

  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load, enabled]);

  usePolling(load, 60 * 60_000, enabled);
  return state.market === market ? state : { news: null, error: null, lastUpdated: null };
}
