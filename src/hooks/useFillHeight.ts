import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sizes an element to run from where it starts down to the bottom of the window, so the chart
 * (with its time axis) fits on screen without scrolling. Whatever sits above it can wrap onto
 * more lines and the chart shrinks to match; it never goes below `min` pixels. A `fixed` height
 * (the user dragged the chart's resize grip) replaces the automatic one.
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, min: number, bottomGap = 16, deps: unknown[] = [], fixed: number | null = null) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (fixed != null) {
      el.style.height = `${Math.max(min, fixed)}px`;
      return () => {
        el.style.height = '';
      };
    }
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + window.scrollY;
        el.style.height = `${Math.max(min, Math.floor(window.innerHeight - top - bottomGap))}px`;
      });
    };
    fit();
    // Anything above the chart changing size (chips added, header wrapping) moves its top.
    const ro = new ResizeObserver(fit);
    for (const child of Array.from(el.parentElement?.children ?? [])) if (child !== el) ro.observe(child);
    ro.observe(document.body);
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', fit);
      el.style.height = '';
    };
  }, [ref, min, bottomGap, fixed, ...deps]);
}
