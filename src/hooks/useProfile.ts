import { useEffect, useState } from 'react';
import type { Profile } from '../lib/types.ts';

const cache = new Map<string, Profile>();

/** Sector, market cap, P/E. Fetched once per symbol per page load (the edge caches it for 6h). */
export function useProfile(symbol: string): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(() => cache.get(symbol) ?? null);
  useEffect(() => {
    const hit = cache.get(symbol);
    if (hit) {
      setProfile(hit);
      return;
    }
    setProfile(null);
    const c = new AbortController();
    fetch(`/api/profile?symbol=${encodeURIComponent(symbol)}`, { signal: c.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Profile>) : null))
      .then((p) => {
        if (!p) return;
        cache.set(symbol, p);
        setProfile(p);
      })
      .catch(() => {
        /* fundamentals are optional; the strip just stays hidden */
      });
    return () => c.abort();
  }, [symbol]);
  return profile;
}
