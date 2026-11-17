import { describe, expect, it } from 'vitest';
import { decodeEntities, mergeNews, parseRss, snippet } from './news.ts';

const xml = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Sebi lowers margin requirements]]></title><link>https://example.com/a</link>
<pubDate>Tue, 17 Nov 2026 20:06:13 +0530</pubDate><description><![CDATA[<img src="x.jpg"/>The regulator &amp; exchanges agreed. More text follows here.]]></description></item>
<item><title>Dow &amp; S&amp;P fall</title><link>https://example.com/b</link><pubDate>Tue, 17 Nov 2026 18:04:32 +0000</pubDate><description>Stocks slid.</description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Tue, 17 Nov 2026 18:04:32 +0000</pubDate></item>
<item><title>No date</title><link>https://example.com/c</link></item>
</channel></rss>`;

const NOW = Date.parse('2026-11-17T20:00:00Z') / 1000;

describe('parseRss', () => {
  it('reads title, link, time and a plain-text summary, skipping unsafe or undated items', () => {
    const items = parseRss(xml, 'Test', NOW);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ title: 'Sebi lowers margin requirements', summary: 'The regulator & exchanges agreed. More text follows here.', link: 'https://example.com/a', source: 'Test', time: Date.parse('2026-11-17T14:36:13Z') / 1000 });
    expect(items[1].title).toBe('Dow & S&P fall');
  });
  it('decodes numeric entities', () => {
    expect(decodeEntities('It&#8217;s &#x20B9;5')).toBe('It’s ₹5');
  });
  it('shortens long descriptions at a sentence or word boundary', () => {
    const long = 'First sentence is here and it is fairly long to read. ' + 'word '.repeat(80);
    expect(snippet(long, 100)).toBe('First sentence is here and it is fairly long to read.');
    expect(snippet('word '.repeat(80), 50).endsWith('…')).toBe(true);
  });
});

describe('mergeNews', () => {
  it('sorts newest first, drops duplicates across feeds and stale items', () => {
    const a = { title: 'Nifty hits a record', summary: '', link: 'https://a', source: 'A', time: NOW - 100 };
    const b = { ...a, title: 'Nifty hits a record!', source: 'B', time: NOW - 50 };
    const c = { ...a, title: 'Old news', time: NOW - 10 * 86400 };
    const d = { ...a, title: 'Newest', time: NOW - 10 };
    expect(mergeNews([[a, c], [b, d]], 10, 4, NOW).map((x) => x.title)).toEqual(['Newest', 'Nifty hits a record!']);
  });
});
