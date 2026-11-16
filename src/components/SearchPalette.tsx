import { useEffect, useMemo, useRef, useState } from 'react';
import { POPULAR, loadSymbols, searchSymbols, type MarketFilter, type SymbolEntry } from '../lib/search.ts';
import { load, save } from '../lib/storage.ts';

export type SearchMode = 'chart' | 'compare' | 'watchlist';

interface Props {
  open: boolean;
  mode?: SearchMode;
  /** Shown in the header, e.g. the watchlist name. */
  context?: string;
  onClose: () => void;
  onSelect: (symbol: string) => void;
}

const MODE_TITLE: Record<SearchMode, (ctx?: string) => string | null> = {
  chart: () => null,
  compare: () => 'Add a stock or index to compare',
  watchlist: (ctx) => `Add to watchlist${ctx ? ` “${ctx}”` : ''}`,
};

const FILTERS: Array<{ id: MarketFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'IN', label: 'India' },
  { id: 'US', label: 'US' },
];

const KIND_LABEL = { s: 'Stock', e: 'ETF', i: 'Index' } as const;
const RECENT_KEY = 'smv.recent';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function rememberRecent(symbol: string): void {
  const recent = load(RECENT_KEY, [] as string[], isStringArray).filter((s) => s !== symbol);
  save(RECENT_KEY, [symbol, ...recent].slice(0, 8));
}

export function SearchPalette({ open, mode = 'chart', context, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MarketFilter>('ALL');
  const [entries, setEntries] = useState<SymbolEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    setTimeout(() => input.current?.focus(), 0);
    if (!entries) {
      loadSymbols()
        .then((e) => {
          setEntries(e);
          setLoadError(false);
        })
        .catch(() => setLoadError(true));
    }
  }, [open]);

  const bySymbol = useMemo(() => new Map((entries ?? []).map((e) => [e.symbol, e])), [entries]);

  const results: SymbolEntry[] = useMemo(() => {
    if (!entries) return [];
    if (query.trim()) return searchSymbols(entries, query, filter);
    const recent = load(RECENT_KEY, [] as string[], isStringArray);
    const popular = filter === 'ALL' ? [...POPULAR.IN.slice(0, 4), ...POPULAR.US.slice(0, 4)] : POPULAR[filter];
    const seen = new Set<string>();
    return [...recent, ...popular]
      .map((s) => bySymbol.get(s))
      .filter((e): e is SymbolEntry => !!e && (filter === 'ALL' || e.market === filter) && !seen.has(e.symbol) && !!seen.add(e.symbol))
      .slice(0, 12);
  }, [entries, query, filter, bySymbol]);

  useEffect(() => setCursor(0), [query, filter]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const choose = (e: SymbolEntry | undefined) => {
    if (!e) return;
    if (mode === 'chart') rememberRecent(e.symbol);
    onSelect(e.symbol);
    onClose();
  };
  const title = MODE_TITLE[mode](context);

  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(results[cursor]);
    } else if (ev.key === 'Escape') {
      onClose();
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      const i = FILTERS.findIndex((f) => f.id === filter);
      setFilter(FILTERS[(i + (ev.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length].id);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={title ?? 'Search stocks'} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        {title && <div className="palette-title">{title}</div>}
        <div className="palette-input-row">
          <svg className="palette-icon" viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or symbol: Reliance, TCS, Apple, NVDA…"
            aria-label="Search stocks"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-filters" role="tablist" aria-label="Market">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
          <span className="palette-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Tab</kbd> to switch market
          </span>
        </div>

        <ul className="palette-results" ref={list} role="listbox">
          {!entries && !loadError && Array.from({ length: 6 }, (_, i) => <li key={i} className="palette-row skeleton-row"><span className="skeleton skeleton-text" style={{ width: `${50 + i * 6}%` }} /></li>)}
          {loadError && (
            <li className="palette-empty">
              Couldn't load the stock list.{' '}
              <button className="link" onClick={() => loadSymbols().then(setEntries).then(() => setLoadError(false)).catch(() => {})}>
                Try again
              </button>
            </li>
          )}
          {entries && results.length === 0 && (
            <li className="palette-empty">No matches for “{query}”. Try the company name or the symbol, e.g. INFY or MSFT.</li>
          )}
          {entries && !query.trim() && results.length > 0 && <li className="palette-section">Recent and popular</li>}
          {results.map((e, i) => (
            <li
              key={e.symbol}
              data-index={i}
              role="option"
              aria-selected={i === cursor}
              className={`palette-row ${i === cursor ? 'selected' : ''}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => choose(e)}
            >
              <span className="palette-symbol">{e.base}</span>
              <span className="palette-name">{e.name}</span>
              <span className="palette-tags">
                {e.kind !== 's' && <span className="badge subtle">{KIND_LABEL[e.kind]}</span>}
                <span className={`badge market-${e.market}`}>{e.exchange === 'US' ? 'US' : e.exchange}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
