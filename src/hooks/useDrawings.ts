import { useCallback, useEffect, useState } from 'react';
import { commit as commitHistory, historyOf, isDrawing, redo as redoHistory, undo as undoHistory, type Drawing, type History } from '../lib/drawings.ts';
import { load, save } from '../lib/storage.ts';

const keyFor = (symbol: string) => `smv.drawings.${symbol}`;
const isDrawingList = (v: unknown): v is Drawing[] => Array.isArray(v) && v.every(isDrawing);

/** The open stock's drawings, saved in this browser, with undo/redo for this session. */
export function useDrawings(symbol: string) {
  const [state, setState] = useState<{ symbol: string; h: History }>(() => ({ symbol, h: historyOf(load(keyFor(symbol), [], isDrawingList)) }));

  // Switching stock loads that stock's drawings with a fresh history.
  useEffect(() => {
    setState((s) => (s.symbol === symbol ? s : { symbol, h: historyOf(load(keyFor(symbol), [], isDrawingList)) }));
  }, [symbol]);

  const h = state.symbol === symbol ? state.h : historyOf(load(keyFor(symbol), [], isDrawingList));

  const apply = useCallback(
    (fn: (h: History) => History) =>
      setState((s) => {
        const next = fn(s.h);
        if (next !== s.h) save(keyFor(s.symbol), next.present);
        return { ...s, h: next };
      }),
    [],
  );

  return {
    drawings: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    commit: useCallback((next: Drawing[]) => apply((x) => commitHistory(x, next)), [apply]),
    remove: useCallback((id: string) => apply((x) => commitHistory(x, x.present.filter((d) => d.id !== id))), [apply]),
    clear: useCallback(() => apply((x) => (x.present.length ? commitHistory(x, []) : x)), [apply]),
    undo: useCallback(() => apply(undoHistory), [apply]),
    redo: useCallback(() => apply(redoHistory), [apply]),
  };
}
