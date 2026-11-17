import { useEffect, useRef, useState } from 'react';
import { setAppearance, useAppearance } from '../lib/theme.ts';

/** Top-bar popover: dark/light theme and the price-colour palette. */
export function AppearanceMenu() {
  const a = useAppearance();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-root appearance" ref={root}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label="Appearance" title="Appearance">
        <svg viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && (
        <div className="menu appearance-menu" role="dialog" aria-label="Appearance">
          <div className="setting">
            <span className="setting-label">Theme</span>
            <div className="segmented text" role="radiogroup" aria-label="Theme">
              <button role="radio" aria-checked={a.theme === 'dark'} className={a.theme === 'dark' ? 'active' : ''} onClick={() => setAppearance({ theme: 'dark' })}>
                Dark
              </button>
              <button role="radio" aria-checked={a.theme === 'light'} className={a.theme === 'light' ? 'active' : ''} onClick={() => setAppearance({ theme: 'light' })}>
                Light
              </button>
            </div>
          </div>
          <div className="setting">
            <span className="setting-label">Up / down colours</span>
            <div className="segmented text" role="radiogroup" aria-label="Up and down colours">
              <button role="radio" aria-checked={a.palette === 'classic'} className={a.palette === 'classic' ? 'active' : ''} onClick={() => setAppearance({ palette: 'classic' })}>
                Green / red
              </button>
              <button role="radio" aria-checked={a.palette === 'cb'} className={a.palette === 'cb' ? 'active' : ''} onClick={() => setAppearance({ palette: 'cb' })}>
                Blue / orange
              </button>
            </div>
            <span className="setting-hint">Blue / orange is easier to tell apart with red-green colour blindness.</span>
          </div>
        </div>
      )}
    </div>
  );
}
