import { useEffect, useRef, useState } from 'react';
import { OVERLAYS, OVERLAY_BY_ID, swatchColor, type OverlayGroup, type OverlayId } from '../lib/overlays.ts';
import { InfoIcon, InfoTip } from './InfoTip.tsx';

interface Props {
  active: ReadonlySet<OverlayId>;
  intraday: boolean;
  barCount: number;
  onToggle: (id: OverlayId) => void;
  onClear: () => void;
}

const GROUPS: OverlayGroup[] = ['Moving averages', 'Trend & volatility', 'Oscillators (own panel)', 'Candlestick patterns', 'Key levels', 'Events'];

/** Why an overlay can't show right now, or null. */
export function overlayUnavailable(id: OverlayId, intraday: boolean, barCount: number): string | null {
  const def = OVERLAY_BY_ID.get(id)!;
  if (def.intradayOnly && !intraday) return 'Only on intraday candles (1m to 1h)';
  if (def.minBars && barCount > 0 && barCount < def.minBars) return `Needs ${def.minBars} candles; pick a longer period`;
  return null;
}

/** The "Indicators" dropdown: every indicator, pattern and level, grouped, with explanations. */
export function OverlayMenu({ active, intraday, barCount, onToggle, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => input.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.infotip')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = filter.trim().toLowerCase();
  const count = [...active].filter((id) => OVERLAY_BY_ID.has(id)).length;

  return (
    <div className="menu-root" ref={root}>
      <button className={`tool-btn ${open ? 'pressed' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M2 15l5-6 4 3 7-8" />
        </svg>
        Indicators
        {count > 0 && <span className="count">{count}</span>}
      </button>
      {open && (
        <div className="menu" role="dialog" aria-label="Indicators and patterns">
          <div className="menu-head">
            <input ref={input} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: RSI, engulfing, support…" aria-label="Filter indicators" />
            {count > 0 && (
              <button className="link" onClick={onClear}>
                Clear all
              </button>
            )}
          </div>
          <div className="menu-body">
            {GROUPS.map((g) => {
              const items = OVERLAYS.filter((o) => o.group === g && (!q || o.label.toLowerCase().includes(q) || o.info.toLowerCase().includes(q)));
              if (!items.length) return null;
              return (
                <section key={g} className="menu-group">
                  <h3>{g}</h3>
                  {items.map((o) => {
                    const why = overlayUnavailable(o.id, intraday, barCount);
                    const on = active.has(o.id);
                    return (
                      <label key={o.id} className={`menu-item ${why ? 'unavailable' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => onToggle(o.id)} aria-label={o.label} />
                        <span className="swatch" style={{ background: swatchColor(o) }} />
                        <span className="menu-label">{o.label}</span>
                        {why && on && <span className="menu-note">{why}</span>}
                        <InfoTip text={why && !on ? `${o.info} (${why}.)` : o.info}>
                          <span className="info-btn" tabIndex={0} aria-label={`About ${o.label}`} onClick={(e) => e.preventDefault()}>
                            <InfoIcon />
                          </span>
                        </InfoTip>
                      </label>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Removable chips for what's on the chart, each with its explanation on hover. */
export function ActiveOverlays({ active, intraday, barCount, onToggle }: { active: ReadonlySet<OverlayId>; intraday: boolean; barCount: number; onToggle: (id: OverlayId) => void }) {
  const items = OVERLAYS.filter((o) => active.has(o.id));
  if (!items.length) return null;
  return (
    <div className="active-overlays" aria-label="Active indicators">
      {items.map((o) => {
        const why = overlayUnavailable(o.id, intraday, barCount);
        return (
          <InfoTip key={o.id} text={why ? `${o.info} Not shown: ${why.toLowerCase()}.` : o.info}>
            <span className={`overlay-chip ${why ? 'muted' : ''}`} tabIndex={0}>
              <span className="swatch" style={{ background: swatchColor(o) }} />
              {o.label}
              <button className="chip-x" onClick={() => onToggle(o.id)} aria-label={`Remove ${o.label}`}>
                ×
              </button>
            </span>
          </InfoTip>
        );
      })}
    </div>
  );
}
