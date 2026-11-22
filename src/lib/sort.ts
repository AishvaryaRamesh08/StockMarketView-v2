/**
 * Table sorting shared by every Portfolio table. Numbers sort numerically, text alphabetically
 * (case-insensitive, natural order for numbers inside text), and missing values always go last.
 */
export type SortDir = 'asc' | 'desc';
export type SortValue = number | string | null | undefined;

export interface SortState<K extends string> {
  key: K | null;
  dir: SortDir;
}

export function compareValues(a: SortValue, b: SortValue): number {
  const missA = a == null || (typeof a === 'number' && Number.isNaN(a));
  const missB = b == null || (typeof b === 'number' && Number.isNaN(b));
  if (missA || missB) return missA === missB ? 0 : missA ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/**
 * A sorted copy of `rows`. Missing values stay last in both directions; ties keep their original
 * order, so the table doesn't shuffle on equal values.
 */
export function sortRows<T, K extends string>(rows: readonly T[], state: SortState<K>, value: (row: T, key: K) => SortValue): T[] {
  const { key } = state;
  if (key == null) return [...rows];
  const sign = state.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: value(row, key) }))
    .sort((x, y) => {
      const missX = x.v == null;
      const missY = y.v == null;
      if (missX || missY) return missX === missY ? x.i - y.i : missX ? 1 : -1;
      return sign * compareValues(x.v, y.v) || x.i - y.i;
    })
    .map((x) => x.row);
}

/**
 * Next state when a column header is clicked: a new column starts in its natural direction
 * (text A→Z, numbers largest first); clicking the same column again flips it; a third click
 * goes back to the table's default order.
 */
export function nextSort<K extends string>(state: SortState<K>, key: K, firstDir: SortDir): SortState<K> {
  if (state.key !== key) return { key, dir: firstDir };
  if (state.dir === firstDir) return { key, dir: firstDir === 'asc' ? 'desc' : 'asc' };
  return { key: null, dir: firstDir };
}
