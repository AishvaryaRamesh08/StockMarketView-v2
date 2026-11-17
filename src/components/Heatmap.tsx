import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPct, formatPrice } from '../lib/format.ts';
import type { PulseStock } from '../lib/marketData.ts';
import { changeColor, sectors, type SectorSummary } from '../lib/pulse.ts';
import { squarify, type Tile } from '../lib/treemap.ts';

interface Props {
  stocks: PulseStock[];
  currency: string;
  onOpen: (symbol: string) => void;
}

const HEADER = 18;
const GAP = 2;

/**
 * Sector heatmap: each sector's area is its total market cap, each stock's tile its own market
 * cap, coloured by today's % change. Click a tile to open its chart.
 */
export function Heatmap({ stocks, currency, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ s: PulseStock; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!size.w || !size.h || !stocks.length) return [];
    // Stocks without a known cap get the median, so they still appear.
    const caps = stocks.map((s) => s.cap ?? 0).filter((c) => c > 0).sort((a, b) => a - b);
    const median = caps[Math.floor(caps.length / 2)] || 1;
    const capOf = (s: PulseStock) => s.cap || median;
    const secs = sectors(stocks).map((sec) => ({ ...sec, cap: sec.stocks.reduce((a, s) => a + capOf(s), 0) }));
    return squarify(secs, (s) => s.cap, { x: 0, y: 0, w: size.w, h: size.h }).map((t) => ({
      sector: t,
      tiles: squarify(t.item.stocks, capOf, { x: t.x + GAP, y: t.y + HEADER, w: Math.max(0, t.w - 2 * GAP), h: Math.max(0, t.h - HEADER - GAP) }),
    }));
  }, [stocks, size.w, size.h]);

  return (
    <div className="heatmap" ref={box} onMouseLeave={() => setHover(null)}>
      {layout.map(({ sector }: { sector: Tile<SectorSummary> }) => (
        <div key={sector.item.name} className="hm-sector" style={{ left: sector.x, top: sector.y, width: sector.w, height: sector.h }}>
          {sector.w > 60 && (
            <div className="hm-sector-label">
              <span>{sector.item.name}</span>
              <b className={sector.item.chg >= 0 ? 'up' : 'down'}>{formatPct(sector.item.chg)}</b>
            </div>
          )}
        </div>
      ))}
      {layout.flatMap(({ tiles }) =>
        tiles.map((t) => {
          const s = t.item;
          const big = t.w > 46 && t.h > 30;
          return (
            <button
              key={s.s}
              className="hm-tile"
              style={{ left: t.x, top: t.y, width: Math.max(0, t.w - 1), height: Math.max(0, t.h - 1), background: changeColor(s.chg) }}
              onClick={() => onOpen(s.s)}
              onMouseMove={(e) => {
                const r = box.current!.getBoundingClientRect();
                setHover({ s, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              aria-label={`${s.n} ${formatPct(s.chg)}`}
            >
              {big && (
                <>
                  <span className="hm-sym" style={{ fontSize: Math.min(15, Math.max(10, t.w / 6)) }}>
                    {s.s.replace(/\.(NS|BO)$/, '')}
                  </span>
                  {t.h > 42 && <span className="hm-chg">{formatPct(s.chg)}</span>}
                </>
              )}
            </button>
          );
        }),
      )}
      {hover && (
        <div className="hm-hover" style={{ left: Math.min(hover.x + 14, size.w - 220), top: Math.min(hover.y + 14, size.h - 80) }}>
          <div className="hm-hover-name">{hover.s.n}</div>
          <div className="hm-hover-row">
            <span className="num">{formatPrice(hover.s.p, currency)}</span>
            <b className={`num ${hover.s.chg >= 0 ? 'up' : 'down'}`}>{formatPct(hover.s.chg)}</b>
          </div>
          <div className="hm-hover-sec">{hover.s.sec}</div>
        </div>
      )}
      {!stocks.length && <div className="skeleton hm-skeleton" />}
    </div>
  );
}
