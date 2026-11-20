import { useEffect, useRef } from 'react';

interface Props {
  onClose: () => void;
  onGo: (view: 'markets' | 'chart' | 'portfolio') => void;
  searchKey: string;
}

const VIEWS = [
  {
    id: 'chart' as const,
    title: 'Chart',
    text: 'Live candles, indicators, pattern markers, drawing tools and a plain-English summary.',
    icon: <path d="M3 15l4-5 3 3 7-8M3 18h14" />,
  },
  {
    id: 'markets' as const,
    title: 'Markets',
    text: 'Indices, top gainers and losers, market news and today’s patterns.',
    icon: <path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z" />,
  },
  {
    id: 'portfolio' as const,
    title: 'Portfolio',
    text: 'Practise trading with virtual ₹10 lakh and $100,000; see P&L by stock and day.',
    icon: <path d="M3 7h14v10H3zM7 7V4h6v3M3 11h14" />,
  },
];

const FEATURES: Array<[string, string]> = [
  ['Search', 'any NSE, BSE or US stock'],
  ['IN / US', '(top right) switches the whole site between India and the US'],
  ['Hover or tap', 'anything underlined or marked ? for an explanation'],
  ['Star', 'stocks to keep them in your watchlist'],
  ['Draw, save, share', 'trend lines, chart images and links'],
  ['Replay', 'past markets candle by candle and practise trading'],
  ['Below each chart', 'how each pattern did on that stock, and a SIP calculator'],
];

/**
 * The welcome guide: opens on the first visit, and from the ? button later. Compact on desktop;
 * on a phone it is a bottom sheet that leaves the top of the page in view. Choosing Markets or
 * Portfolio goes there; anything else stays on the chart.
 */
export function Welcome({ onClose, onGo, searchKey }: Props) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the dialog itself (not the button at the bottom) so a phone opens it at the top.
    dialog.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="welcome-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" ref={dialog} tabIndex={-1}>
        <button className="icon-btn welcome-x" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
        <h2 id="welcome-title">Welcome to StockMarketView</h2>
        <p className="welcome-lead">Free live charts for Indian (NSE, BSE) and US stocks, refreshed every 30 seconds. No sign-up: everything stays in this browser.</p>

        <p className="welcome-section">Where would you like to start?</p>
        <div className="welcome-views">
          {VIEWS.map((v) => (
            <button key={v.id} className={`welcome-view v-${v.id}`} onClick={() => (v.id === 'chart' ? onClose() : onGo(v.id))}>
              <span className="welcome-view-head">
                <svg viewBox="0 0 20 20" aria-hidden>
                  {v.icon}
                </svg>
                <b>{v.title}</b>
              </span>
              <span className="welcome-view-text">{v.text}</span>
            </button>
          ))}
        </div>

        <div className="welcome-ai">
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
          </svg>
          <span>
            <b>Ask AI</b> (top right): type or say “show Reliance for a year with RSI” or “how is my portfolio doing?”. Uses your own free Gemini key.
          </span>
        </div>

        <ul className="welcome-features">
          {FEATURES.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b> {k === 'Search' ? <span className="welcome-key">({searchKey}) </span> : null}
              {v}
            </li>
          ))}
        </ul>

        <div className="welcome-foot">
          <span>For learning only. Nothing here is investment advice.</span>
          <button className="btn primary" onClick={onClose}>
            Start with the chart
          </button>
        </div>
      </div>
    </div>
  );
}
