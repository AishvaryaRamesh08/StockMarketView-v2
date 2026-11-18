import { useEffect, useRef, useState } from 'react';
import { formatPct, formatPrice, digitsFor } from '../lib/format.ts';
import { OVERLAY_BY_ID } from '../lib/overlays.ts';
import type { Badge } from '../hooks/useWatchlistBadges.ts';
import type { Quote } from '../lib/types.ts';
import type { useWatchlists } from '../hooks/useWatchlists.ts';
import { InfoTip } from './InfoTip.tsx';
import { Sparkline } from './Sparkline.tsx';

interface Props {
  wl: ReturnType<typeof useWatchlists>;
  quotes: Record<string, Quote>;
  patterns: Record<string, Badge | undefined>;
  current: string;
  onSelect: (symbol: string) => void;
  onAdd: () => void;
  onClose?: () => void;
}

function PriceCell({ q }: { q: Quote }) {
  const prev = useRef(q.price);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (q.price != null && prev.current != null && q.price !== prev.current) {
      setFlash(q.price > prev.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 900);
      prev.current = q.price;
      return () => clearTimeout(t);
    }
    prev.current = q.price;
  }, [q.price]);
  return <span className={`wl-price num ${flash}`}>{formatPrice(q.price, q.currency, digitsFor(q.priceHint, q.price), false)}</span>;
}

export function WatchlistPanel({ wl, quotes, patterns, current, onSelect, onAdd, onClose }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startRename = () => {
    setEditing(wl.active.id);
    setName(wl.active.name);
  };
  const finishRename = () => {
    if (editing) wl.rename(editing, name);
    setEditing(null);
  };

  return (
    <aside className="watchlist" aria-label="Watchlist">
      <div className="wl-head">
        {editing ? (
          <input className="wl-name-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={finishRename} onKeyDown={(e) => e.key === 'Enter' && finishRename()} aria-label="Watchlist name" />
        ) : (
          <select className="wl-select" value={wl.active.id} onChange={(e) => (e.target.value === '__new' ? wl.create(`List ${wl.lists.length + 1}`) : wl.setActive(e.target.value))} aria-label="Choose watchlist">
            {wl.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.symbols.length})
              </option>
            ))}
            <option value="__new">+ New watchlist</option>
          </select>
        )}
        <div className="wl-actions">
          <button className="icon-btn" onClick={onAdd} title="Add a stock" aria-label="Add a stock">
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <button className="icon-btn" onClick={startRename} title="Rename list" aria-label="Rename list">
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M3 13h3l7-7-3-3-7 7z" />
            </svg>
          </button>
          {confirmDelete ? (
            <button
              className="icon-btn danger"
              onClick={() => {
                wl.remove(wl.active.id);
                setConfirmDelete(false);
              }}
              onBlur={() => setConfirmDelete(false)}
              title="Click again to delete this list"
            >
              Delete?
            </button>
          ) : (
            <button className="icon-btn" onClick={() => setConfirmDelete(true)} title="Delete list" aria-label="Delete list">
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9" />
              </svg>
            </button>
          )}
          {onClose && (
            <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close watchlist">
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {wl.active.symbols.length === 0 ? (
        <div className="wl-empty">
          <p>This list is empty.</p>
          <button className="btn" onClick={onAdd}>
            Add a stock
          </button>
          <p className="wl-tip">Tip: press ☆ next to any stock's name to add it.</p>
        </div>
      ) : (
        <ul className="wl-list">
          {wl.active.symbols.map((s) => {
            const q = quotes[s];
            const hit = patterns[s];
            const def = hit ? OVERLAY_BY_ID.get(hit.pattern) : null;
            const dir = q?.change == null ? '' : q.change >= 0 ? 'up' : 'down';
            return (
              <li key={s} className={`wl-row ${s === current ? 'active' : ''}`}>
                <button className="wl-main" onClick={() => onSelect(s)}>
                  <span className="wl-sym">
                    <span className="wl-ticker">{s.replace(/\.(NS|BO)$/, '').replace(/^\^/, '')}</span>
                    {def && (
                      <InfoTip text={`${def.label} in the latest completed session (daily candles). ${def.info}`}>
                        <span className={`pattern-badge ${hit!.bias}`}>{hit!.bias === 'bullish' ? '▲' : '▼'} {def.label.replace(/^(Bullish|Bearish) /, '')}</span>
                      </InfoTip>
                    )}
                    <span className="wl-name">{q?.name ?? ''}</span>
                  </span>
                  <Sparkline values={q?.spark} prevClose={q?.prevClose} />
                  <span className="wl-quote">
                    {q ? <PriceCell q={q} /> : <span className="skeleton skeleton-text" style={{ width: 54 }} />}
                    <span className={`wl-change num ${dir}`}>{q ? formatPct(q.changePct) : ''}</span>
                  </span>
                </button>
                <button className="wl-remove" onClick={() => wl.toggle(s)} aria-label={`Remove ${s} from watchlist`} title="Remove">
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
