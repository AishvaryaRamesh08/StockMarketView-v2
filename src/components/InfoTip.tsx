import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover or keyboard-focus tooltip. Rendered in a portal with fixed positioning so it is never
 * clipped by scrolling menus or the chart panel.
 */
export function InfoTip({ text, children, className = '' }: { text: string; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 140;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: below ? r.bottom + 8 : r.top - 8, below });
  };

  return (
    <span ref={ref} className={`infotip-anchor ${className}`} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}
      // Touch screens have no hover: a tap shows the tip for a few seconds.
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return;
        show();
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setPos(null), 4500);
      }} aria-describedby={pos ? id : undefined}>
      {children}
      {pos &&
        createPortal(
          <span id={id} role="tooltip" className={`infotip ${pos.below ? 'below' : ''}`} style={{ left: pos.x, top: pos.y }}>
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

export function InfoIcon() {
  return (
    <svg className="info-icon" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7.2v3.8M8 5v.01" />
    </svg>
  );
}
