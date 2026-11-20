import { formatPct, formatPrice } from '../lib/format.ts';
import type { Quote } from '../lib/types.ts';
import { useScrollFade } from '../hooks/useScrollFade.ts';

export const STRIP_INDICES: Array<{ symbol: string; label: string }> = [
  { symbol: '^NSEI', label: 'NIFTY 50' },
  { symbol: '^BSESN', label: 'SENSEX' },
  { symbol: '^NSEBANK', label: 'BANK NIFTY' },
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'NASDAQ' },
  { symbol: '^DJI', label: 'DOW' },
];

export function IndexStrip({ quotes, active, onSelect }: { quotes: Record<string, Quote>; active: string; onSelect: (s: string) => void }) {
  const fade = useScrollFade<HTMLElement>();
  return (
    <nav className="index-strip" aria-label="Market indices" ref={fade}>
      {STRIP_INDICES.map(({ symbol, label }) => {
        const q = quotes[symbol];
        const dir = q?.change == null ? '' : q.change >= 0 ? 'up' : 'down';
        return (
          <button key={symbol} className={`index-chip ${symbol === active ? 'active' : ''}`} onClick={() => onSelect(symbol)}>
            <span className="index-name">{label}</span>
            {q ? (
              <>
                <span className="index-price num">{formatPrice(q.price, q.currency, 2, false)}</span>
                <span className={`index-change num ${dir}`}>{formatPct(q.changePct)}</span>
              </>
            ) : (
              <span className="skeleton skeleton-text" style={{ width: 90 }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}
