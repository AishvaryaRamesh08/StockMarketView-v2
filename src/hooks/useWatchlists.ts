import { useCallback, useEffect, useState } from 'react';
import { load, save } from '../lib/storage.ts';

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface State {
  lists: Watchlist[];
  activeId: string;
}

const KEY = 'smv.watchlists';
export const MAX_PER_LIST = 40;

function initial(): State {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const india = tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta';
  const lists: Watchlist[] = [
    { id: 'in', name: 'India', symbols: ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS'] },
    { id: 'us', name: 'US', symbols: ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'TSLA', 'SPY'] },
  ];
  return { lists, activeId: india ? 'in' : 'us' };
}

function isState(v: unknown): v is State {
  const s = v as State;
  return (
    !!s &&
    typeof s.activeId === 'string' &&
    Array.isArray(s.lists) &&
    s.lists.every((l) => typeof l.id === 'string' && typeof l.name === 'string' && Array.isArray(l.symbols) && l.symbols.every((x) => typeof x === 'string'))
  );
}

/** Named watchlists kept in this browser. */
export function useWatchlists() {
  const [state, setState] = useState<State>(() => load(KEY, initial(), isState));
  useEffect(() => save(KEY, state), [state]);

  const active = state.lists.find((l) => l.id === state.activeId) ?? state.lists[0];

  const update = useCallback((fn: (s: State) => State) => setState((s) => fn(s)), []);

  const api = {
    lists: state.lists,
    active,
    setActive: (id: string) => update((s) => ({ ...s, activeId: id })),
    create: (name: string) => {
      const id = Math.random().toString(36).slice(2, 9);
      update((s) => ({ lists: [...s.lists, { id, name: name.trim() || 'New list', symbols: [] }], activeId: id }));
    },
    rename: (id: string, name: string) => update((s) => ({ ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) })),
    remove: (id: string) =>
      update((s) => {
        const lists = s.lists.filter((l) => l.id !== id);
        if (lists.length === 0) lists.push({ id: 'default', name: 'Watchlist', symbols: [] });
        return { lists, activeId: s.activeId === id ? lists[0].id : s.activeId };
      }),
    /** Adds to or removes from the active list. */
    toggle: (symbol: string) =>
      update((s) => ({
        ...s,
        lists: s.lists.map((l) => {
          if (l.id !== (s.lists.find((x) => x.id === s.activeId) ?? s.lists[0]).id) return l;
          if (l.symbols.includes(symbol)) return { ...l, symbols: l.symbols.filter((x) => x !== symbol) };
          if (l.symbols.length >= MAX_PER_LIST) return l;
          return { ...l, symbols: [...l.symbols, symbol] };
        }),
      })),
    move: (symbol: string, delta: number) =>
      update((s) => ({
        ...s,
        lists: s.lists.map((l) => {
          if (l.id !== s.activeId) return l;
          const i = l.symbols.indexOf(symbol);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= l.symbols.length) return l;
          const symbols = [...l.symbols];
          [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
          return { ...l, symbols };
        }),
      })),
  };
  return api;
}
