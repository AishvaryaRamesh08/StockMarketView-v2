/**
 * Market headlines from public RSS feeds. Only the headline, a short snippet, the source and a
 * link to the full article are kept; nothing is stored beyond the edge cache.
 */
import type { MarketId } from '../src/lib/types.ts';

export interface NewsItem {
  title: string;
  /** First sentence or so of the feed's description, plain text. */
  summary: string;
  link: string;
  source: string;
  /** Unix seconds. */
  time: number;
}

export interface NewsResponse {
  market: MarketId;
  items: NewsItem[];
}

export interface FeedSource {
  name: string;
  url: string;
}

/** Yahoo's India feeds are weeks old, so Indian headlines come from two Indian business papers. */
export const NEWS_FEEDS: Record<MarketId, FeedSource[]> = {
  IN: [
    { name: 'The Economic Times', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
    { name: 'Mint', url: 'https://www.livemint.com/rss/markets' },
  ],
  US: [{ name: 'Yahoo Finance', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EIXIC,%5EDJI&region=US&lang=en-US' }],
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text of a tag, with CDATA unwrapped, HTML removed and whitespace collapsed. */
function tag(item: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(item);
  if (!m) return '';
  let v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  v = decodeEntities(v);
  // Descriptions sometimes carry HTML (an image, a link); after decoding, strip it.
  v = v.replace(/<[^>]*>/g, ' ');
  return v.replace(/\s+/g, ' ').trim();
}

/** About two lines: whole sentences up to `max` characters, else a word-boundary cut. */
export function snippet(text: string, max = 220): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.lastIndexOf('. ');
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\-–]$/, '') + '…';
}

export function parseRss(xml: string, source: string, nowSec = Math.floor(Date.now() / 1000)): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const raw = m[1];
    const title = tag(raw, 'title');
    const link = tag(raw, 'link');
    const time = Math.floor(Date.parse(tag(raw, 'pubDate')) / 1000);
    if (!title || !/^https:\/\//i.test(link) || !Number.isFinite(time)) continue;
    // A feed occasionally carries a future-dated item; clamp it so it doesn't pin to the top.
    items.push({ title, summary: snippet(tag(raw, 'description')), link, source, time: Math.min(time, nowSec) });
  }
  return items;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Newest first, duplicates across feeds removed, at most `limit` items from the last `maxAgeDays`. */
export function mergeNews(lists: NewsItem[][], limit = 24, maxAgeDays = 4, nowSec = Math.floor(Date.now() / 1000)): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of lists.flat().sort((a, b) => b.time - a.time)) {
    const key = norm(item.title);
    if (seen.has(key) || nowSec - item.time > maxAgeDays * 86400) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
