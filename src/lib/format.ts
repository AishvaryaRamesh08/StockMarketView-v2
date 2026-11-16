const priceFormatters = new Map<string, Intl.NumberFormat>();

function localeFor(currency: string): string {
  return currency === 'INR' ? 'en-IN' : 'en-US';
}

/** ₹1,344.80 or $353.19 — grouped the way each market writes it (lakh/crore for INR). */
export function formatPrice(value: number | null | undefined, currency: string, digits = 2, withSymbol = true): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const key = `${currency}|${digits}|${withSymbol}`;
  let f = priceFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(localeFor(currency), {
      style: withSymbol ? 'currency' : 'decimal',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    priceFormatters.set(key, f);
  }
  return f.format(value);
}

export function formatChange(value: number | null | undefined, currency: string, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return sign + formatPrice(Math.abs(value), currency, digits, false);
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** 12.4M / 3.2Cr style compact volume. */
export function formatVolume(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (currency === 'INR') {
    if (value >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
    if (value >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
    return value.toLocaleString('en-IN');
  }
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** "3:30 PM" in the visitor's own time zone, plus the zone name when it differs from the exchange's. */
export function formatLocalTime(date: Date, withDay = false): string {
  return date.toLocaleString(undefined, {
    weekday: withDay ? 'short' : undefined,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function digitsFor(priceHint: number | undefined, price: number | null): number {
  if (price != null && price < 1) return 4;
  return Math.min(Math.max(priceHint ?? 2, 2), 4);
}
