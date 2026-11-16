import { useNow } from '../hooks/useNow.ts';
import { MARKETS, formatCountdown, marketStatus } from '../lib/markets.ts';
import { formatLocalTime } from '../lib/format.ts';
import type { MarketId } from '../lib/types.ts';

const FLAGS: Record<MarketId, string> = { IN: 'IN', US: 'US' };

export function MarketStatusPill({ market, compact = false }: { market: MarketId; compact?: boolean }) {
  const now = useNow(1000);
  const s = marketStatus(market, new Date(now));
  const cfg = MARKETS[market];
  const inMs = s.next.getTime() - now;
  const nextIsFar = inMs > 20 * 3600_000;
  const when = nextIsFar ? formatLocalTime(s.next, true) : `in ${formatCountdown(inMs)}`;
  const title =
    `${cfg.name} market (${cfg.open}–${s.earlyClose ?? cfg.close} ${cfg.tzLabel})\n` +
    `${s.nextLabel} ${formatLocalTime(s.next, true)} your time` +
    (s.holiday?.provisional ? '\nHoliday date is provisional until the exchange confirms it.' : '') +
    (s.earlyClose ? `\nEarly close today at ${s.earlyClose} ${cfg.tzLabel}` : '');

  return (
    <div className={`status-pill state-${s.state}`} title={title}>
      <span className="status-dot" aria-hidden />
      <span className="status-market">{FLAGS[market]}</span>
      <span className="status-label">{s.state === 'holiday' ? 'Holiday' : s.label}</span>
      {!compact && (
        <span className="status-next">
          {s.nextLabel.toLowerCase()} {when}
        </span>
      )}
    </div>
  );
}
