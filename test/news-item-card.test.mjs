// sow-445 (owner, 2026-10-08): a news story posted with a gbti.network link unfurls as itself, "<headline> |
// <publication>" with its summary and picture, instead of the shell every story shared. The story page draws itself in
// the browser, which no preview bot runs, so functions/news/item/index.js fills the card before the page leaves. It
// FAILS CLOSED to the plain page on every miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { storyRequest, feedUrlFor, storyCard, newsItemHead, isPreviewBot, SITE_NAME } from '../src/lib/news-item-head.mjs';
import { onRequest } from '../functions/news/item/index.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The head as BaseLayout writes it for the story page (src/pages/news/item.astro), tags in the built order.
const HEAD = '<head><title>News | GBTI Network</title><meta name="description" content="A story from the curated GBTI Network news stream.">'
  + '<link rel="canonical" href="https://gbti.network/news/item/"><meta property="og:site_name" content="GBTI Network">'
  + '<meta property="og:title" content="News | GBTI Network"><meta property="og:description" content="A story from the curated GBTI Network news stream.">'
  + '<meta property="og:type" content="website"><meta property="og:url" content="https://gbti.network/news/item/">'
  + '<meta property="og:image" content="https://gbti.network/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
  + '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://gbti.network/og-image.png"></head><body>story</body>';
const STORY = { guid: 'https://arstechnica.com/?p=1', source: 'ars-technica', title: 'Chips & "dips"', link: 'https://arstechnica.com/x', image: 'https://cdn.arstechnica.net/a.jpg?w=1&amp;h=2', summary: 'A whole sentence about chips.' };
const SOURCES = { sources: [{ id: 'ars-technica', name: 'Ars Technica', description: 'arstechnica.com' }] };
const REQ = { guid: STORY.guid, source: 'ars-technica' };

test('the request: the guid and a safe source hint, as the page reads them', () => {
  assert.deepEqual(storyRequest('https://gbti.network/news/item/?g=abc&s=ars-technica'), { guid: 'abc', source: 'ars-technica' });
  assert.deepEqual(storyRequest('https://gbti.network/news/item/?g=abc&s=%3Cscript%3E'), { guid: 'abc', source: '' }, 'an unsafe hint is dropped');
  assert.equal(storyRequest('https://gbti.network/news/item/'), null);
  assert.equal(storyRequest('https://gbti.network/news/item/?g=' + 'a'.repeat(2001)), null);
  assert.equal(feedUrlFor('https://signup.gbti.network', REQ), 'https://signup.gbti.network/news/feed?limit=60&source=ars-technica');
  assert.equal(feedUrlFor('https://signup.gbti.network', { source: '' }), 'https://signup.gbti.network/news/feed?limit=60');
  // the page's own lookup, so the card describes a story exactly when the page can show it
  assert.match(read('src/pages/news/item.astro'), /base \+ '\/news\/feed\?limit=60' \+ \(sourceHint && \/\^\[a-z0-9\]\[a-z0-9 _\.-\]\{0,60\}\$\/i\.test\(sourceHint\)/);
});

test('the card: headline | publication for the card, headline | GBTI Network for the tab, its own address', () => {
  const card = storyCard({ items: [{ guid: 'other' }, STORY] }, REQ, SOURCES);
  assert.equal(card.cardTitle, 'Chips & "dips" | Ars Technica');
  assert.equal(card.tabTitle, `Chips & "dips" | ${SITE_NAME}`);
  assert.equal(card.description, 'A whole sentence about chips.');
  assert.equal(card.image, 'https://cdn.arstechnica.net/a.jpg?w=1&h=2', 'an escaped ampersand is decoded, as the page does');
  assert.equal(card.url, `https://gbti.network/news/item/?g=${encodeURIComponent(STORY.guid)}&s=ars-technica`);
  assert.equal(storyCard({ items: [STORY] }, { guid: 'gone', source: '' }, SOURCES), null, 'a story the feed no longer holds');
  assert.equal(storyCard(null, REQ, SOURCES), null);
  assert.equal(storyCard({ items: [STORY] }, REQ, null).cardTitle, 'Chips & "dips" | arstechnica.com', 'no source list: the domain');
  assert.equal(storyCard({ items: [{ ...STORY, image: 'http://insecure/a.jpg' }] }, REQ, SOURCES).image, '', 'a card picture must be https');
  const long = storyCard({ items: [{ ...STORY, summary: `${'word '.repeat(120)}end.` }] }, REQ, SOURCES).description;
  assert.ok(long.length <= 303 && long.endsWith('...'), `trimmed on a word (${long.length})`);
  assert.equal(SITE_NAME, /SITE_NAME = '([^']+)'/.exec(read('src/lib/brand.ts'))[1]);
});

test('the head: every card tag replaced and escaped, the default picture size gone, nothing else touched', () => {
  const card = storyCard({ items: [STORY] }, REQ, SOURCES);
  const { html, changed } = newsItemHead(HEAD, card);
  assert.equal(changed, true);
  assert.match(html, /<title>Chips &amp; &quot;dips&quot; \| GBTI Network<\/title>/);
  assert.match(html, /<meta property="og:title" content="Chips &amp; &quot;dips&quot; \| Ars Technica">/);
  assert.match(html, /<meta property="og:description" content="A whole sentence about chips\.">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/cdn\.arstechnica\.net\/a\.jpg\?w=1&amp;h=2">/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/cdn\.arstechnica\.net\/a\.jpg\?w=1&amp;h=2">/);
  assert.doesNotMatch(html, /og:image:(width|height)/, 'those were the default picture\'s size');
  const own = `https://gbti.network/news/item/?g=${encodeURIComponent(STORY.guid)}&amp;s=ars-technica`;
  assert.ok(html.includes(`<meta property="og:url" content="${own}">`) && html.includes(`<link rel="canonical" href="${own}">`), 'its own address, not the shared bare one');
  const strip = (h) => h.replace(/<title>[^<]*<\/title>|<meta property="og:(title|description|url|image|image:width|image:height)"[^>]*>|<meta name="twitter:image"[^>]*>|<link rel="canonical"[^>]*>/g, '');
  assert.equal(strip(html), strip(HEAD), 'nothing outside the card tags changes');
});

test('the head is all or nothing, and a card with no picture keeps the default one and its size', () => {
  const card = storyCard({ items: [STORY] }, REQ, SOURCES);
  for (const tag of ['<link rel="canonical" href="https://gbti.network/news/item/">', '<meta name="twitter:image" content="https://gbti.network/og-image.png">', '<meta property="og:url" content="https://gbti.network/news/item/">']) {
    const r = newsItemHead(HEAD.replace(tag, ''), card);
    assert.deepEqual(r, { html: HEAD.replace(tag, ''), changed: false }, `without ${tag.slice(0, 30)}`);
  }
  assert.equal(newsItemHead(HEAD, null).changed, false);
  const plain = newsItemHead(HEAD, { ...card, image: '', description: '' }).html;
  assert.match(plain, /og:image" content="https:\/\/gbti\.network\/og-image\.png">/);
  assert.match(plain, /og:image:width/);
  assert.match(plain, /og:description" content="A story from the curated GBTI Network news stream\.">/, 'no summary: the generic line stays');
});

test('the layout still writes every tag the rewriter needs, in the shape it matches', () => {
  const src = read('src/layouts/BaseLayout.astro');
  for (const re of [/<title>\{fullTitle\}<\/title>/, /<link rel="canonical" href=\{canonical\} \/>/, /<meta property="og:title" content=\{cardTitle\} \/>/,
    /<meta property="og:description" content=\{description\} \/>/, /<meta property="og:url" content=\{canonical\} \/>/,
    /<meta property="og:image" content=\{ogImageUrl\} \/>/, /<meta name="twitter:image" content=\{ogImageUrl\} \/>/]) {
    assert.match(src, re);
  }
});

// The edge function, with the static page, the Worker and the site's own files all faked.
const html = (body = HEAD) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', etag: '"abc"', 'x-frame-options': 'DENY' } });
const LINKEDIN = 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ctx = (url, { method = 'GET', page = html(), sources = SOURCES, ua = LINKEDIN } = {}) => ({
  request: new Request(url, { method, headers: { 'user-agent': ua } }),
  next: async () => page,
  env: { ASSETS: { fetch: async () => (sources ? Response.json(sources) : new Response('', { status: 404 })) } },
});
const URL1 = `https://gbti.network/news/item/?g=${encodeURIComponent(STORY.guid)}&s=ars-technica`;
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, o) => { calls.push(String(u)); return fake(u, o); };
  try { return { result: await fn(), calls }; } finally { globalThis.fetch = real; }
}

test('the function fills the card from the feed, keeps the static headers, and drops the stale length and etag', async () => {
  const { result: res, calls } = await withFetch(async () => Response.json({ items: [STORY] }), () => onRequest(ctx(URL1)));
  assert.deepEqual(calls, ['https://signup.gbti.network/news/feed?limit=60&source=ars-technica']);
  const body = await res.text();
  assert.match(body, /og:title" content="Chips &amp; &quot;dips&quot; \| Ars Technica"/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY', 'the site\'s security headers ride along');
  assert.equal(res.headers.get('etag'), null);
});

test('every miss serves the plain page: no guid, a gone story, a failed or slow lookup, a POST, a non-HTML answer', async () => {
  const plain = async (c, fake) => (await withFetch(fake, () => onRequest(c))).result.text();
  const story = async () => Response.json({ items: [STORY] });
  assert.equal(await plain(ctx('https://gbti.network/news/item/'), story), HEAD);
  assert.equal(await plain(ctx(URL1), async () => Response.json({ items: [{ guid: 'other', title: 'x' }] })), HEAD);
  assert.equal(await plain(ctx(URL1), async () => new Response('', { status: 502 })), HEAD);
  assert.equal(await plain(ctx(URL1), async () => { throw new Error('network'); }), HEAD);
  assert.equal(await plain(ctx(URL1), async () => new Response('not json', { status: 200 })), HEAD);
  // A lookup that never answers. Without the function's own time limit it would hang, and the race says so. The race's
  // timer also holds Node open, which AbortSignal.timeout's timer does not (the edge runtime waits for it).
  const slow = (u, o) => new Promise((resolve, reject) => { o?.signal?.addEventListener('abort', () => reject(o.signal.reason)); });
  const t0 = Date.now();
  const raced = await withFetch(slow, () => Promise.race([onRequest(ctx(URL1)), new Promise((r) => setTimeout(() => r('UNBOUNDED'), 4500))]));
  assert.notEqual(raced.result, 'UNBOUNDED', 'the lookup is bounded (3 s)');
  assert.equal(await raced.result.text(), HEAD);
  assert.ok(Date.now() - t0 < 4500);
  assert.equal(await plain(ctx(URL1, { method: 'POST' }), story), HEAD);
  const json = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  assert.equal(await (await withFetch(story, () => onRequest(ctx(URL1, { page: json })))).result.text(), '{}');
});

test('only a preview fetcher waits for the card; a person gets the page at once, with no lookup', async () => {
  for (const ua of [LINKEDIN, 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'WhatsApp/2.23.20.0', 'TelegramBot (like TwitterBot)', 'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)']) {
    assert.equal(isPreviewBot(ua), true, ua);
  }
  for (const ua of [CHROME, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', '']) {
    assert.equal(isPreviewBot(ua), false, ua);
  }
  const { result, calls } = await withFetch(async () => Response.json({ items: [STORY] }), () => onRequest(ctx(URL1, { ua: CHROME })));
  assert.equal(await result.text(), HEAD);
  assert.deepEqual(calls, [], 'no lookup for a person');
});

test('the function never logs', () => {
  const src = read('functions/news/item/index.js');
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /console\./);
});
