import { useState } from 'react';
import { nextSort, sortRows, type SortDir, type SortState, type SortValue } from '../lib/sort.ts';

/** Sort state for one table, plus the sorted rows. */
export function useSortedRows<T, K extends string>(rows: readonly T[], value: (row: T, key: K) => SortValue, initial: SortState<K> = { key: null, dir: 'asc' }) {
  const [state, setState] = useState<SortState<K>>(initial);
  return {
    rows: sortRows(rows, state, value),
    state,
    toggle: (key: K, firstDir: SortDir) => setState((s) => nextSort(s, key, firstDir)),
  };
}

/**
 * A clickable column heading. Text columns start A→Z, number columns largest first; a second
 * click flips the order and a third goes back to the table's own order.
 */
export function SortHeader<K extends string>({
  label,
  k,
  sort,
  numeric = false,
  className = '',
}: {
  label: string;
  k: K;
  sort: { state: SortState<K>; toggle: (key: K, firstDir: SortDir) => void };
  numeric?: boolean;
  className?: string;
}) {
  const active = sort.state.key === k;
  const dir = active ? sort.state.dir : null;
  return (
    <span className={`${className} sort-cell`} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" className={`sort-head ${active ? 'active' : ''} ${numeric ? 'numeric' : ''}`} onClick={() => sort.toggle(k, numeric ? 'desc' : 'asc')} title={`Sort by ${label.toLowerCase()}`}>
        {label}
        <span className="sort-arrow" aria-hidden>
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
        </span>
      </button>
    </span>
  );
}
