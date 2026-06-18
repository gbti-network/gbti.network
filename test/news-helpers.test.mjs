// SOW-043 groundwork: the pure news helpers (client-ui/src/news.mjs) — UTM link building, the news->card-item
// projection, and blending news into a content+shares feed as supplementary. Deploy-independent; no DOM/client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UTM, utmLink, newsToItem, blendNews } from '../client-ui/src/news.mjs';

// The news worker serves publishedAt/fetchedAt as EPOCH SECONDS.
const SEC = (iso) => Math.floor(Date.parse(iso) / 1000);
const news = (over = {}) => ({ guid: 'g1', source: 'Example', title: 'A headline', link: 'https://ex.com/a', summary: 'A blurb', category: 'ai', publishedAt: SEC('2026-06-16T00:00:00Z'), fetchedAt: SEC('2026-06-16T01:00:00Z'), ...over });

test('utmLink appends the GBTI UTM params, preserving existing query', () => {
  const u = new URL(utmLink('https://ex.com/a?x=1'));
  assert.equal(u.searchParams.get('x'), '1');
  assert.equal(u.searchParams.get('utm_source'), 'gbti-network');
  assert.equal(u.searchParams.get('utm_medium'), 'extension');
  assert.equal(u.searchParams.get('utm_campaign'), 'news');
});

test('utmLink falls through on a non-URL / empty input', () => {
  assert.equal(utmLink('not a url'), 'not a url');
  assert.equal(utmLink(''), '');
  assert.equal(utmLink(null), '');
});

test('utmLink overwrites a pre-existing utm_source rather than duplicating it', () => {
  const u = new URL(utmLink('https://ex.com/a?utm_source=other'));
  assert.equal(u.searchParams.getAll('utm_source').length, 1);
  assert.equal(u.searchParams.get('utm_source'), 'gbti-network');
});

test('newsToItem projects onto the card shape: members + supplementary, UTM openHref, source as author', () => {
  const it = newsToItem(news());
  assert.equal(it.type, 'news');
  assert.equal(it.supplementary, true);
  assert.equal(it.visibility, 'members'); // news is a paid perk
  assert.equal(it.author, 'Example');
  assert.equal(it.category, 'ai');
  assert.equal(it.excerpt, 'A blurb');
  assert.equal(it.createdAt, Date.parse('2026-06-16T00:00:00Z')); // epoch seconds -> ms
  assert.match(it.openHref, /utm_campaign=news/);
  assert.equal(it.guid, 'g1');
});

test('newsToItem degrades gracefully (no link, no title)', () => {
  const it = newsToItem({ source: 'Src' });
  assert.equal(it.title, 'Src');     // falls back to source
  assert.equal(it.openHref, null);   // no link -> no outbound href
  assert.equal(it.excerpt, '');
});

test('blendNews keeps content primary, flags news supplementary, interleaves newest-first, caps news', () => {
  const content = [
    { type: 'post', title: 'old post', createdAt: '2026-01-01T00:00:00Z' },
    { type: 'post', title: 'new post', createdAt: '2026-06-17T00:00:00Z' },
  ];
  const items = [news({ guid: 'n1', publishedAt: SEC('2026-06-10T00:00:00Z') }), news({ guid: 'n2', publishedAt: SEC('2026-06-18T00:00:00Z') })];
  const out = blendNews(content, items, { cap: 5 });
  assert.equal(out.length, 4);
  // newest-first across both kinds
  assert.deepEqual(out.map((x) => x.title || x.guid).slice(0, 1), ['A headline']); // n2 @ 06-18 is newest
  // news items are flagged supplementary; content is not
  assert.equal(out.find((x) => x.guid === 'n2').supplementary, true);
  assert.equal(out.find((x) => x.title === 'new post').supplementary, undefined);
});

test('blendNews caps the news supplement and can filter by category (case-insensitive)', () => {
  const items = [news({ guid: 'a', category: 'AI' }), news({ guid: 'b', category: 'devops' }), news({ guid: 'c', category: 'ai' })];
  const onlyAi = blendNews([], items, { categories: new Set(['ai']) });
  assert.deepEqual(onlyAi.map((x) => x.guid).sort(), ['a', 'c']);
  const capped = blendNews([], items, { cap: 1 });
  assert.equal(capped.length, 1);
});

test('blendNews does not mutate inputs + tolerates empties', () => {
  const content = [{ type: 'post', title: 'p', createdAt: 1 }];
  const before = content.slice();
  blendNews(content, [news()]);
  assert.deepEqual(content, before);
  assert.deepEqual(blendNews(), []);
  assert.deepEqual(blendNews([], []), []);
});

test('UTM is the documented extension/news campaign', () => {
  assert.deepEqual({ ...UTM }, { utm_source: 'gbti-network', utm_medium: 'extension', utm_campaign: 'news' });
});
