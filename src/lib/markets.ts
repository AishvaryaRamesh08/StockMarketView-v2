import { INDIA_HOLIDAYS, US_HOLIDAYS, type Holiday } from '../data/holidays.ts';
import type { MarketId } from './types.ts';

interface MarketConfig {
  id: MarketId;
  name: string;
  timezone: string;
  tzLabel: string;
  /** Pre-open (India) or pre-market (US) start, exchange-local "HH:MM". */
  preOpen: string;
  preOpenLabel: string;
  open: string;
  close: string;
  holidays: Holiday[];
}

export const MARKETS: Record<MarketId, MarketConfig> = {
  IN: {
    id: 'IN',
    name: 'India',
    timezone: 'Asia/Kolkata',
    tzLabel: 'IST',
    preOpen: '09:00',
    preOpenLabel: 'Pre-open',
    open: '09:15',
    close: '15:30',
    holidays: INDIA_HOLIDAYS,
  },
  US: {
    id: 'US',
    name: 'US',
    timezone: 'America/New_York',
    tzLabel: 'ET',
    preOpen: '04:00',
    preOpenLabel: 'Pre-market',
    open: '09:30',
    close: '16:00',
    holidays: US_HOLIDAYS,
  },
};

export type MarketState = 'open' | 'pre-open' | 'closed' | 'holiday';

export interface MarketStatus {
  market: MarketId;
  state: MarketState;
  /** "Open", "Pre-open", "Closed", or the holiday's name. */
  label: string;
  /** When the state next changes, and what it changes to. */
  next: Date;
  nextLabel: 'Opens' | 'Closes';
  holiday?: Holiday;
  earlyClose?: string;
}

/** Which market a Yahoo symbol trades on. */
export function marketOf(symbol: string): MarketId {
  if (/\.(NS|BO)$/i.test(symbol) || ['^NSEI', '^BSESN', '^NSEBANK', '^CNXIT', '^INDIAVIX'].includes(symbol.toUpperCase())) return 'IN';
  return 'US';
}

/* ------------------------------ time-zone maths ----------------------------- */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(tz: string, date: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number; wd: number } {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, wd };
}

/** Offset of `tz` from UTC at `date`, in milliseconds (IST = +5.5h). */
export function tzOffsetMs(tz: string, date: Date): number {
  const p = partsIn(tz, date);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads `ymd` `hhmm`. */
export function zonedTime(tz: string, ymd: string, hhmm: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset even on DST-change days.
  let t = guess - tzOffsetMs(tz, new Date(guess));
  t = guess - tzOffsetMs(tz, new Date(t));
  return new Date(t);
}

function ymdIn(tz: string, date: Date): string {
  const p = partsIn(tz, date);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function weekday(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/* --------------------------------- sessions --------------------------------- */

interface Session {
  ymd: string;
  preOpen: Date;
  open: Date;
  close: Date;
  earlyClose?: string;
}

function holidayOn(cfg: MarketConfig, ymd: string): Holiday | undefined {
  return cfg.holidays.find((h) => h.date === ymd);
}

/** The trading session on `ymd`, or null on weekends and full holidays. */
function sessionOn(cfg: MarketConfig, ymd: string): Session | null {
  const wd = weekday(ymd);
  if (wd === 0 || wd === 6) return null;
  const h = holidayOn(cfg, ymd);
  if (h && !h.earlyClose) return null;
  return {
    ymd,
    preOpen: zonedTime(cfg.timezone, ymd, cfg.preOpen),
    open: zonedTime(cfg.timezone, ymd, cfg.open),
    close: zonedTime(cfg.timezone, ymd, h?.earlyClose ?? cfg.close),
    earlyClose: h?.earlyClose,
  };
}

function nextSessionAfter(cfg: MarketConfig, ymd: string): Session {
  for (let i = 1; i <= 14; i++) {
    const s = sessionOn(cfg, addDays(ymd, i));
    if (s) return s;
  }
  throw new Error(`No ${cfg.id} session within two weeks of ${ymd}`);
}

export function marketStatus(market: MarketId, now: Date = new Date()): MarketStatus {
  const cfg = MARKETS[market];
  const today = ymdIn(cfg.timezone, now);
  const session = sessionOn(cfg, today);
  const holiday = holidayOn(cfg, today);

  if (session) {
    if (now >= session.open && now < session.close) {
      return { market, state: 'open', label: 'Open', next: session.close, nextLabel: 'Closes', earlyClose: session.earlyClose };
    }
    if (now >= session.preOpen && now < session.open) {
      return { market, state: 'pre-open', label: cfg.preOpenLabel, next: session.open, nextLabel: 'Opens' };
    }
    if (now < session.preOpen) {
      return { market, state: 'closed', label: 'Closed', next: session.open, nextLabel: 'Opens' };
    }
  }

  const next = nextSessionAfter(cfg, today);
  if (holiday && !holiday.earlyClose) {
    return { market, state: 'holiday', label: holiday.name, next: next.open, nextLabel: 'Opens', holiday };
  }
  return { market, state: 'closed', label: 'Closed', next: next.open, nextLabel: 'Opens' };
}

/** "2h 05m", "14m 09s", "3d 4h" */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}
