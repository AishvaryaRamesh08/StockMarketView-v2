import { useEffect, useRef, useState, type ReactElement } from 'react';
import { TOOL_LABEL, type DrawTool } from '../lib/drawings.ts';

interface Props {
  tool: DrawTool | null;
  onTool: (t: DrawTool | null) => void;
  hasSelection: boolean;
  drawingCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onClear: () => void;
  onDownload: () => void;
  onCopyImage: () => void;
  onShare: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

const TOOL_ICONS: Record<DrawTool, ReactElement> = {
  trend: <path d="M3 15L15 4M3 15h.01M15 4h.01" />,
  hline: <path d="M2 10h14M9 10h.01" />,
  rect: <rect x="3" y="5" width="12" height="9" rx="1" />,
  fib: <path d="M2 4h14M2 7.5h14M2 10.5h14M2 14h14" />,
  text: <path d="M4 4h10M9 4v11M7 15h4" />,
};

const TOOL_HINT: Record<DrawTool, string> = {
  trend: 'Click two points, or drag from one to the other',
  hline: 'Click a price',
  rect: 'Click two opposite corners, or drag',
  fib: 'Click the swing low then the swing high (or high then low), or drag',
  text: 'Click where the note should go',
};

/** Drawing tools, undo/redo, image export and share, in one row above the chart. */
export function ChartActions(p: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => !exportRoot.current?.contains(e.target as Node) && setExportOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  return (
    <div className="chart-actions">
      <div className="draw-tools" role="toolbar" aria-label="Drawing tools">
        {(Object.keys(TOOL_LABEL) as DrawTool[]).map((t) => (
          <button
            key={t}
            className={`icon-btn ${p.tool === t ? 'pressed' : ''}`}
            aria-pressed={p.tool === t}
            onClick={() => p.onTool(p.tool === t ? null : t)}
            title={`${TOOL_LABEL[t]}: ${TOOL_HINT[t]}`}
            aria-label={TOOL_LABEL[t]}
          >
            <svg viewBox="0 0 18 18" aria-hidden>
              {TOOL_ICONS[t]}
            </svg>
          </button>
        ))}
        <span className="divider" aria-hidden />
        <button className="icon-btn" onClick={p.onUndo} disabled={!p.canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
          <svg viewBox="0 0 18 18" aria-hidden>
            <path d="M6 5L3 8l3 3M3 8h8a4 4 0 0 1 0 8H8" />
          </svg>
        </button>
        <button className="icon-btn" onClick={p.onRedo} disabled={!p.canRedo} title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} aria-label="Redo">
          <svg viewBox="0 0 18 18" aria-hidden>
            <path d="M12 5l3 3-3 3M15 8H7a4 4 0 0 0 0 8h3" />
          </svg>
        </button>
        <button className="icon-btn" onClick={p.onDelete} disabled={!p.hasSelection} title="Delete selected drawing (Delete)" aria-label="Delete selected drawing">
          <svg viewBox="0 0 18 18" aria-hidden>
            <path d="M4 5h10M7 5V3.5h4V5M5.5 5l.7 10h5.6l.7-10" />
          </svg>
        </button>
        {p.drawingCount > 0 &&
          (confirmClear ? (
            <button
              className="icon-btn danger"
              onClick={() => {
                p.onClear();
                setConfirmClear(false);
              }}
              onBlur={() => setConfirmClear(false)}
              autoFocus
            >
              Remove all {p.drawingCount}?
            </button>
          ) : (
            <button className="icon-btn text-btn" onClick={() => setConfirmClear(true)} title="Remove every drawing on this stock">
              Clear
            </button>
          ))}
      </div>

      {p.tool && <span className="tool-hint">{TOOL_HINT[p.tool]} · Esc to cancel</span>}

      <div className="share-tools">
        <div className="menu-root" ref={exportRoot}>
          <button className="tool-btn" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen} aria-haspopup="menu">
            <svg viewBox="0 0 20 20" aria-hidden>
              <rect x="3" y="4" width="14" height="11" rx="1.5" />
              <path d="M6 12l3-3 2 2 3-3" />
            </svg>
            Image
          </button>
          {exportOpen && (
            <div className="menu export-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setExportOpen(false);
                  p.onDownload();
                }}
              >
                Download PNG
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setExportOpen(false);
                  p.onCopyImage();
                }}
              >
                Copy image
              </button>
            </div>
          )}
        </div>
        <button className="tool-btn" onClick={p.onShare} title="Copy a link that opens this chart">
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M8 12l4-4M7 9.5l-1.5 1.5a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7" />
          </svg>
          Share
        </button>
      </div>
    </div>
  );
}

/** Small input that appears where a text note is placed or edited. */
export function TextNoteInput({ x, y, initial, onSave, onCancel }: { x: number; y: number; initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // After the click that opened it has finished, so nothing else takes focus back.
    const t = setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const done = () => (value.trim() ? onSave(value.trim().slice(0, 140)) : onCancel());
  return (
    <div className="text-note-input" style={{ left: x, top: y }}>
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') done();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={done}
        placeholder="Type a note, Enter to save"
        maxLength={140}
        aria-label="Note text"
      />
    </div>
  );
}
