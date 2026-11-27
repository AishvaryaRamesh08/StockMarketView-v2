import { useEffect, useState } from 'react';

/** Whether a CSS media query matches, kept current as the window resizes. */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Wide enough for a docked right-hand column beside the chart (matches styles.css). */
export const WIDE_QUERY = '(min-width: 1280px)';
