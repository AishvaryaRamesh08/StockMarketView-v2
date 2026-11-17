/**
 * Links a headline to the stocks it mentions, so "Nvidia falls as…" can show NVDA's move today.
 * Plain name matching against the index constituents: no AI, no extra requests.
 */

export interface Matchable {
  s: string;
  n: string;
  cap?: number;
}

const SUFFIXES = /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group|class [a-c]|the|n\.?v|s\.?a|ag|se|lp)\b\.?/gi;

/** Words that start many company names, or are ordinary words in headlines. */
const STOP = new Set([
  'american', 'general', 'united', 'first', 'national', 'international', 'global', 'india', 'indian', 'bank', 'new', 'southern', 'northern',
  'western', 'eastern', 'public', 'energy', 'capital', 'financial', 'health', 'power', 'life', 'data', 'digital', 'state', 'steel', 'oil',
  'motors', 'target', 'block', 'match', 'booking', 'progressive', 'regions', 'citizens', 'principal', 'genuine', 'universal', 'consolidated',
  'realty', 'texas', 'pacific', 'gold', 'india', 'royal', 'central', 'ever', 'best', 'live', 'news', 'fox', 'equity', 'trade', 'market',
]);

function words(name: string): string[] {
  return name
    .replace(SUFFIXES, ' ')
    .replace(/[^A-Za-z0-9&.' -]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.'-]+|[.,'-]+$/g, ''))
    .filter(Boolean);
}

/** Company names that headlines mostly use for something else: an index, or a fund family. */
const NAME_EXCLUDE = new Set(['nasdaq', 'state street', 'dow']);

/** Tickers that are also everyday words in headlines. */
const TICKER_WORDS = new Set(['ALL', 'NOW', 'KEY', 'CAT', 'LOW', 'BIG', 'ARE', 'FAST', 'CASH', 'GOOD', 'HAS', 'ON', 'IT', 'ONE', 'NEW', 'TECH', 'PLAY', 'BEST', 'CARE', 'LIFE', 'HOME', 'GAS', 'OIL', 'CAR', 'BALL', 'SEE', 'WELL', 'TRUE', 'AI', 'UPS', 'NET', 'META', 'ICE', 'FOX', 'DAY', 'EAT', 'RUN', 'ALLY', 'WAT', 'MOS', 'TAP']);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface StockMatcher {
  s: string;
  cap: number;
  re: RegExp;
}

/**
 * One pattern per stock: its distinctive first word ("Nvidia", "Salesforce"), or the first two
 * words when several companies share the first ("Tata Motors" vs "Tata Steel"), plus its ticker.
 */
export function buildMatchers(stocks: Matchable[]): StockMatcher[] {
  const firstCount = new Map<string, number>();
  const parts = stocks.map((st) => words(st.n));
  for (const w of parts) if (w[0]) firstCount.set(w[0].toLowerCase(), (firstCount.get(w[0].toLowerCase()) ?? 0) + 1);

  const out: StockMatcher[] = [];
  stocks.forEach((st, i) => {
    const w = parts[i];
    const alts: string[] = [];
    const first = w[0];
    const twoLc = `${first ?? ''} ${w[1] ?? ''}`.toLowerCase().trim();
    if (first && !NAME_EXCLUDE.has(first.toLowerCase()) && !NAME_EXCLUDE.has(twoLc)) {
      const lc = first.toLowerCase();
      const shared = (firstCount.get(lc) ?? 0) > 1;
      if (!shared && !STOP.has(lc) && first.length >= 4) alts.push(nameAlt(first));
      else if (w[1] && (w[1].length >= 3 || shared)) alts.push(`${nameAlt(first)}\\s+${nameAlt(w[1])}`);
    }
    // The ticker itself, exactly as written: "NVDA", "TCS".
    const base = st.s.replace(/\.(NS|BO)$/, '');
    if (/^[A-Z][A-Z0-9&]{2,}$/.test(base) && !TICKER_WORDS.has(base)) alts.push(escape(base));
    if (!alts.length) return;
    out.push({ s: st.s, cap: st.cap ?? 0, re: new RegExp(`(?<![A-Za-z0-9])(?:${alts.join('|')})(?![A-Za-z0-9])`, caseFlag(first)) });
  });
  return out;
}

/** All-caps names (NVIDIA, ICICI) match any capitalisation; others match as written, so "apple" the fruit doesn't. */
function caseFlag(first: string | undefined): string {
  return first && first.length > 1 && first === first.toUpperCase() ? 'i' : '';
}

const nameAlt = (w: string) => escape(w);

/** Stocks mentioned in `text`, largest company first. */
export function matchStocks(text: string, matchers: StockMatcher[], max = 3): string[] {
  const hits = matchers.filter((m) => m.re.test(text));
  return hits
    .sort((a, b) => b.cap - a.cap)
    .slice(0, max)
    .map((m) => m.s);
}
