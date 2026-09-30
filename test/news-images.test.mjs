// Owner report, 2026-09-30: "some of our news items have made it through today without an image." Four causes,
// each pinned here with the real shape that failed:
//   1. an escaped `&amp;` kept in an image address (ClickHouse's og:image answered 400; The Verge and InfoWorld
//      feeds write `&#038;` inside theirs);
//   2. the article read stopping at 60 KB (JetBrains carries its og:image about 66 KB in);
//   3. stories the old scraper gave up on never being tried again;
//   4. the extension's news card showing a bare glyph instead of the branded banner the website shows (sow-149).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { scrapeOgImage, scrapeOgPreview } from '../workers/lib/og-scrape.mjs';
import { readHead, fetchOgImage } from '../workers/signup/news/src/og-image.mjs';
import { parseFeed } from '../workers/signup/news/src/feeds.mjs';
import { publicItem } from '../workers/signup/news/src/api.mjs';
import { backfillImages, SCRAPER_FIXED_AT } from '../workers/signup/news/src/backfill.mjs';

const CLICKHOUSE = 'https://clickhouse.com/_next/image?url=%2Fuploads%2Fpg.png&w=1200&h=630&q=75';

test('an escaped ampersand in an og:image is decoded, for news and for share previews', () => {
  const html = '<head><meta property="og:image" content="https://clickhouse.com/_next/image?url=%2Fuploads%2Fpg.png&amp;w=1200&amp;h=630&amp;q=75"></head>';
  assert.equal(scrapeOgImage(html, 'https://clickhouse.com/blog/x'), CLICKHOUSE);
  assert.equal(scrapeOgPreview(html, 'https://clickhouse.com/blog/x').image, CLICKHOUSE);
});

test('a feed that escapes the ampersand inside an image URL is decoded', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>t</title>
    <item><title>Apple HomePad</title><link>https://www.theverge.com/a</link><guid>g1</guid><pubDate>Tue, 30 Sep 2026 11:11:00 GMT</pubDate>
    <media:content url="https://platform.theverge.com/x.jpg?quality=90&amp;#038;strip=all&amp;#038;crop=0,0,100,100" medium="image"/></item>
  </channel></rss>`;
  const [item] = parseFeed(xml, 'the-verge');
  assert.ok(item?.image, 'the item has its image');
  assert.doesNotMatch(item.image, /&#0*38;|&amp;/, `decoded: ${item.image}`);
  assert.match(item.image, /quality=90&strip=all&crop=/);
});

test('a story stored with an escaped address is served decoded', () => {
  const out = publicItem({ guid: 'g', image: 'https://www.infoworld.com/x.jpg?quality=50&#038;strip=all&#038;w=1024' });
  assert.equal(out.image, 'https://www.infoworld.com/x.jpg?quality=50&strip=all&w=1024');
  assert.equal(publicItem({ guid: 'g' }).image, null);
});

// A body stream the way fetch gives one, in chunks.
function streamed(html, chunk = 8192) {
  const bytes = new TextEncoder().encode(html);
  let at = 0;
  let cancelled = false;
  return {
    get cancelled() { return cancelled; },
    ok: true,
    headers: { get: () => 'text/html; charset=utf-8' },
    body: { getReader: () => ({
      read: async () => { if (at >= bytes.length) return { done: true }; const value = bytes.slice(at, at + chunk); at += chunk; return { done: false, value }; },
      cancel: async () => { cancelled = true; },
    }) },
  };
}

test('the read reaches an og:image deep in a long head, and stops at the end of the head', async () => {
  const filler = `<script>${'x'.repeat(66000)}</script>`; // JetBrains: the og:image sits about 66 KB in
  const page = `<html><head>${filler}<meta property="og:image" content="https://blog.jetbrains.com/og.png"></head><body>${'y'.repeat(500000)}</body></html>`;
  const res = streamed(page);
  const head = await readHead(res);
  assert.ok(head.includes('og:image'), 'reached the tag past 60 KB');
  assert.ok(!head.includes('<body>'), 'stopped at the end of the head');
  assert.equal(res.cancelled, true, 'and stopped downloading the rest');
  const fetchImpl = async () => streamed(page);
  assert.equal(await fetchOgImage('https://blog.jetbrains.com/kotlin/x/', { fetchImpl }), 'https://blog.jetbrains.com/og.png');
});

test('the read never runs past its cap, and still works on a response with no stream', async () => {
  const endless = `<html><head>${'z'.repeat(400000)}`;
  assert.ok((await readHead(streamed(endless), 250000)).length <= 250000);
  const plain = { ok: true, headers: { get: () => 'text/html' }, text: async () => '<head><meta property="og:image" content="/a.png"></head><body>b</body>' };
  assert.equal(await readHead(plain), '<head><meta property="og:image" content="/a.png">');
});

// The backfill's KV, as in test/news-backfill.test.mjs.
function makeEnv(items, day = '2026-09-30') {
  const m = new Map();
  m.set('feed:v2:index', JSON.stringify({ days: [day], counts: { category: {}, source: {} }, total: 0, updatedAt: 0 }));
  m.set(`feed:v2:day:${day}`, JSON.stringify(items));
  return { env: { NEWS_KV: { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } } }, m, day };
}

test('a recent story the old scraper gave up on gets one more try; an old one does not', async () => {
  const now = SCRAPER_FIXED_AT + 3600;
  const { env, m, day } = makeEnv([
    { guid: 'recent', link: 'https://ex.com/recent', image: null, imgTried: SCRAPER_FIXED_AT - 7200, publishedAt: now - 86400 },
    { guid: 'old', link: 'https://ex.com/old', image: null, imgTried: SCRAPER_FIXED_AT - 7200, publishedAt: now - 10 * 86400 },
    { guid: 'since', link: 'https://ex.com/since', image: null, imgTried: SCRAPER_FIXED_AT + 60, publishedAt: now - 600 },
  ]);
  const tried = [];
  const fetchImpl = async (url) => { tried.push(url); return { ok: true, headers: { get: () => 'text/html' }, text: async () => `<meta property="og:image" content="${url}/og.jpg">` }; };
  await backfillImages(env, { now, cap: 12, fetchImpl });
  assert.deepEqual(tried, ['https://ex.com/recent'], 'only the recent one from before the fix');
  const stored = JSON.parse(m.get(`feed:v2:day:${day}`));
  assert.equal(stored.find((i) => i.guid === 'recent').image, 'https://ex.com/recent/og.jpg');
  // It converges: the retried story is marked tried again, so the next run leaves it alone.
  tried.length = 0;
  stored.find((i) => i.guid === 'recent').image = null;
  m.set(`feed:v2:day:${day}`, JSON.stringify(stored));
  await backfillImages(env, { now: now + 60, cap: 12, fetchImpl });
  assert.deepEqual(tried, []);
});

test('the extension\'s news card falls back to the category banner, and a failed story image swaps to it', () => {
  const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-card-list.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ newsFeatureImage \} from '\.\.\/news-feature-image\.mjs'/);
  assert.match(src, /const banner = lc\(item\.type\) === 'news' \? resolveAsset\(newsFeatureImage\(item\.category\)\) : null;/);
  assert.match(src, /const src = thumb \|\| banner;/);
  assert.match(src, /if \(fb\) \{ t\.removeAttribute\('data-fb'\); t\.src = fb; return; \}/);
});
