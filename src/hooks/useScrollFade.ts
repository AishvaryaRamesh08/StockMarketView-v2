import { useCallback, useRef } from 'react';

/** Which edges of a sideways-scrolling strip hide more content. */
export function fadeEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): '' | 'left' | 'right' | 'both' {
  const left = scrollLeft > 2;
  const right = scrollLeft + clientWidth < scrollWidth - 2;
  return left && right ? 'both' : left ? 'left' : right ? 'right' : '';
}

/**
 * Marks a sideways-scrolling strip with data-fade="left|right|both" while content is hidden past
 * that edge, so CSS can fade the edge and show there's more to swipe. Returns a callback ref.
 */
export function useScrollFade<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const update = () => {
      // Only a strip that scrolls sideways at this screen size (the stats line wraps on desktop).
      const scrolls = /auto|scroll/.test(getComputedStyle(el).overflowX);
      const f = scrolls ? fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth) : '';
      if (f) el.dataset.fade = f;
      else delete el.dataset.fade;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Content changes width (prices arrive) without the strip itself resizing.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    cleanup.current = () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
}
