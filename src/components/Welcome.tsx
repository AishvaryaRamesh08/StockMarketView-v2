import { useEffect, useRef } from 'react';

interface Props {
  onClose: () => void;
  onGo: (view: 'markets' | 'chart' | 'portfolio') => void;
  searchKey: string;
}

const VIEWS = [
  {
    id: 'markets' as const,
    title: 'Markets',
    text: "Today's big picture: indices, a heatmap of who's up and down, and stocks that formed a pattern today.",
    icon: <path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z" />,
  },
  {
    id: 'chart' as const,
    title: 'Chart',
    text: 'Live candlestick charts with indicators, pattern markers, drawing tools and a plain-English summary.',
    icon: <path d="M3 15l4-5 3 3 7-8M3 18h14" />,
  },
  {
    id: 'portfolio' as const,
    title: 'Portfolio',
    text: 'Practise trading with virtual money: ₹10 lakh and $100,000 to buy and sell real stocks at live prices.',
    icon: <path d="M3 7h14v10H3zM7 7V4h6v3M3 11h14" />,
  },
];

const FEATURES = [
  ['Search', 'any NSE, BSE or US stock by name or ticker'],
  ['Hover or tap', 'any term with a dotted underline or a ? to see what it means'],
  ['Star', 'stocks to keep them in your watchlists on the left'],
  ['Draw, save and share', 'trend lines and notes, chart images and links'],
];

/** First-visit introduction; reopened from the ? button in the top bar. */
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
        <p className="welcome-lead">Free, live charts for Indian (NSE, BSE) and US stocks, refreshed every 30 seconds. No sign-up: everything you save stays in this browser.</p>

        <p className="welcome-section">Three places to explore, using the tabs at the top</p>
        <div className="welcome-views">
          {VIEWS.map((v) => (
            <button key={v.id} className={`welcome-view v-${v.id}`} onClick={() => onGo(v.id)}>
              <svg viewBox="0 0 20 20" aria-hidden>
                {v.icon}
              </svg>
              <b>{v.title}</b>
              <span>{v.text}</span>
            </button>
          ))}
        </div>

        <div className="welcome-ai">
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
          </svg>
          <span>
            <b>Ask AI</b> (top right): type or say “show Reliance for a year with RSI” or “what is a demat account?” and it draws the chart or explains. Uses your own free Gemini key, kept in your browser.
          </span>
        </div>

        <ul className="welcome-features">
          {FEATURES.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b> {k === 'Search' ? <>({searchKey}) </> : null}
              {v}
            </li>
          ))}
        </ul>

        <div className="welcome-foot">
          <span>For learning only. Nothing here is investment advice.</span>
          <button className="btn primary" onClick={onClose}>
            Start exploring
          </button>
        </div>
      </div>
    </div>
  );
}
