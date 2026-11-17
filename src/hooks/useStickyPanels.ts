import { useEffect } from 'react';

/**
 * The watchlist sidebar and the side panel stick under the top bar. Their height must be the
 * space actually left in the window: less while the index strip is still on screen, more once
 * the page scrolls. CSS alone can't know that, so this sets --topbar-h and each panel's height.
 */
export function useStickyPanels(selectors = '.sidebar-desktop, .trade-dock') {
  useEffect(() => {
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bar = document.querySelector<HTMLElement>('.topbar');
        if (bar) document.documentElement.style.setProperty('--topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
        for (const el of document.querySelectorAll<HTMLElement>(selectors)) {
          // Only the docked (sticky) form; the slide-over and bottom-sheet forms size themselves.
          if (getComputedStyle(el).position !== 'sticky') {
            el.style.height = '';
            continue;
          }
          el.style.height = `${Math.max(240, Math.floor(window.innerHeight - Math.max(0, el.getBoundingClientRect().top)))}px`;
        }
      });
    };
    fit();
    const mo = new MutationObserver(fit);
    const body = document.querySelector('.body');
    if (body) mo.observe(body, { childList: true });
    const ro = new ResizeObserver(fit);
    const bar = document.querySelector('.topbar');
    if (bar) ro.observe(bar);
    window.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, [selectors]);
}
