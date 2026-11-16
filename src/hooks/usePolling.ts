import { useEffect, useRef } from 'react';

export const LIVE_MS = 30_000;
export const CLOSED_MS = 5 * 60_000;

/**
 * Runs `task` every `intervalMs` while the tab is visible. When the tab comes back into view
 * after a refresh was due, it runs straight away instead of waiting for the next tick.
 * The task receives an AbortSignal that fires if a newer run starts or the hook unmounts.
 */
export function usePolling(task: (signal: AbortSignal) => Promise<void>, intervalMs: number, enabled = true): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let lastRun = Date.now();
    let disposed = false;

    const run = async () => {
      controller?.abort();
      controller = new AbortController();
      lastRun = Date.now();
      try {
        await taskRef.current(controller.signal);
      } catch {
        /* the task reports its own errors */
      }
      schedule();
    };

    const schedule = () => {
      clearTimeout(timer);
      if (disposed || document.visibilityState === 'hidden') return;
      timer = setTimeout(run, Math.max(0, intervalMs - (Date.now() - lastRun)));
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastRun >= intervalMs) void run();
        else schedule();
      } else clearTimeout(timer);
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
