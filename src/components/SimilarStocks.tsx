import { digitsFor, formatPct, formatPrice } from '../lib/format.ts';
import type { Quote } from '../lib/types.ts';
import { Sparkline } from './Sparkline.tsx';

interface Props {
  peers: string[];
  basis: 'industry' | 'related';
  quotes: Record<string, Quote>;
  comparing: string[];
  canCompare: boolean;
  onOpen: (symbol: string) => void;
  onCompare: (symbol: string) => void;
}

/** Peers of the open stock, each one click from its chart or from the compare overlay. */
export function SimilarStocks({ peers, basis, quotes, comparing, canCompare, onOpen, onCompare }: Props) {
  if (!peers.length) return null;
  return (
    <section className="similar" aria-labelledby="similar-title">
      <div className="similar-head">
        <h2 id="similar-title">Similar stocks</h2>
        <span className="card-sub">{basis === 'industry' ? 'Same industry, largest first' : 'Related stocks, from Yahoo Finance'}</span>
      </div>
      <div className="similar-row">
        {peers.map((s) => {
          const q = quotes[s];
          const on = comparing.includes(s);
          return (
            <div key={s} className="peer-card">
              <button className="peer-main" onClick={() => onOpen(s)}>
                <span className="peer-sym">{s.replace(/\.(NS|BO)$/, '')}</span>
                <span className="peer-name">{q?.name ?? ''}</span>
                <Sparkline values={q?.spark} prevClose={q?.prevClose} width={96} height={26} />
                <span className="peer-quote">
                  <span className="num">{q ? formatPrice(q.price, q.currency, digitsFor(q.priceHint, q.price), false) : '—'}</span>
                  <span className={`num ${(q?.change ?? 0) >= 0 ? 'up' : 'down'}`}>{q ? formatPct(q.changePct) : ''}</span>
                </span>
              </button>
              <button className={`peer-compare ${on ? 'on' : ''}`} onClick={() => onCompare(s)} disabled={!on && !canCompare} title={on ? 'Remove from comparison' : 'Compare on the chart'}>
                {on ? '✓ Comparing' : '+ Compare'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
