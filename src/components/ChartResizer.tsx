import { useRef, type RefObject } from 'react';

export const CHART_MIN = 320;
export const CHART_MAX = 2000;

/**
 * The grip under the chart: drag it (mouse or finger) to make the chart taller or shorter, use the
 * arrow keys when it has focus, and double-click it or press "Fit" to go back to filling the window.
 */
export function ChartResizer({ target, height, onChange }: { target: RefObject<HTMLElement | null>; height: number | null; onChange: (h: number | null) => void }) {
  const drag = useRef<{ y: number; h: number } | null>(null);
  const clamp = (h: number) => Math.round(Math.min(CHART_MAX, Math.max(CHART_MIN, h)));
  const current = () => target.current?.getBoundingClientRect().height ?? height ?? CHART_MIN;

  return (
    <div className="chart-resizer">
      <div
        className="chart-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize chart"
        aria-valuemin={CHART_MIN}
        aria-valuemax={CHART_MAX}
        aria-valuenow={Math.round(current())}
        tabIndex={0}
        title="Drag to resize the chart · double-click to fit the window"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, h: current() };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const h = clamp(drag.current.h + e.clientY - drag.current.y);
          // Resize straight away for a smooth drag; the saved height follows on release.
          if (target.current) target.current.style.height = `${h}px`;
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const moved = Math.abs(e.clientY - drag.current.y) > 2;
          const h = clamp(drag.current.h + e.clientY - drag.current.y);
          drag.current = null;
          if (moved) onChange(h);
        }}
        onPointerCancel={() => {
          drag.current = null;
          onChange(height);
        }}
        onDoubleClick={() => onChange(null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 100 : 25;
          if (e.key === 'ArrowDown') onChange(clamp(current() + step));
          else if (e.key === 'ArrowUp') onChange(clamp(current() - step));
          else if (e.key === 'Home' || e.key === 'Escape') onChange(null);
          else return;
          e.preventDefault();
        }}
      >
        <span className="chart-grip-bar" aria-hidden />
      </div>
      {height != null && (
        <button type="button" className="chart-fit" onClick={() => onChange(null)} title="Go back to filling the window">
          Fit to window
        </button>
      )}
    </div>
  );
}
