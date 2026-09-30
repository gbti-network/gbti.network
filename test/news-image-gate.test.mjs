// Owner, 2026-09-30: "We need to not let imageless items reach our news feed." A story is listed only with its own
// picture, everywhere news shows (the feeds, the homepage, the bell, the digest), and one whose picture fails to load
// in the browser is removed. No stand-in image of ours is used anywhere a story is listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { queryItems } from '../workers/signup/news/src/store.mjs';
import { findNewsItemByGuid, membershipNews, publicNews } from '../workers/signup/membership-news.mjs';
import { membershipNewsFollowing } from '../workers/signup/membership-news-following.mjs';
import { gatherNewsEntries } from '../workers/signup/mail-compile.mjs';

// A NEWS_KV holding two day files, newest first: the newer day has one story with a picture and two without.
const story = (guid, day, image, publishedAt) => ({ guid, source: 'ex', title: guid, link: `https://ex.com/${guid}`, image, category: 'AI/ML', publishedAt });
function newsEnv() {
  const m = new Map();
  m.set('feed:v2:index', JSON.stringify({ days: ['2026-09-29', '2026-09-30'], counts: { category: {}, source: {} }, total: 5, updatedAt: 1 }));
  m.set('feed:v2:day:2026-09-30', JSON.stringify([
    story('a-pic', '2026-09-30', 'https://ex.com/a.jpg', 1790780000),
    story('b-none', '2026-09-30', null, 1790779000),
    story('c-none', '2026-09-30', '', 1790778000),
  ]));
  m.set('feed:v2:day:2026-09-29', JSON.stringify([
    story('d-pic', '2026-09-29', 'https://ex.com/d.jpg', 1790700000),
    story('e-pic', '2026-09-29', 'https://ex.com/e.jpg', 1790690000),
  ]));
  return { NEWS_KV: { get: async (k, type) => { const v = m.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); }, put: async (k, v) => { m.set(k, v); } } };
}

test('with requireImage the store lists only stories with a picture, and still fills the page from older days', async () => {
  const { items } = await queryItems(newsEnv(), { limit: 2, requireImage: true });
  assert.deepEqual(items.map((i) => i.guid), ['a-pic', 'd-pic']);
});

test('without it the store is unchanged, and a lookup by guid still finds a story with no picture', async () => {
  const { items } = await queryItems(newsEnv(), { limit: 10 });
  assert.equal(items.length, 5);
  const found = await findNewsItemByGuid(newsEnv(), { guid: 'b-none' });
  assert.equal(found?.guid, 'b-none', 'superadmin actions on a known story still resolve it');
});

// Every reader that LISTS stories asks for the gate. A fake queryItems records the filter each one sends.
const recorder = () => { const seen = []; return { seen, queryItems: async (env, filter) => { seen.push(filter); return { items: [], updatedAt: 1 }; } }; };
const req = (url) => ({ url, method: 'GET', headers: { get: () => null } });

test('the public feed and the members\' feed ask for stories with a picture', async () => {
  const pub = recorder();
  await publicNews(req('https://signup.gbti.network/news/feed?limit=60'), { NEWS_KV: {} }, { queryItems: pub.queryItems });
  assert.equal(pub.seen[0]?.requireImage, true, 'the public feed (website News page, homepage, story pages)');
  const mem = recorder();
  await membershipNews(req('https://signup.gbti.network/membership/news?limit=60'), { NEWS_KV: {} }, { queryItems: mem.queryItems, authorize: async () => ({ ok: true, githubId: '1' }) });
  assert.equal(mem.seen[0]?.requireImage, true, 'the extension feed');
});

test('the bell\'s followed news and the weekly digest ask for them too', async () => {
  const bell = recorder();
  const kv = { get: async () => ({ followedChannels: ['ex'] }) };
  await membershipNewsFollowing(req('https://signup.gbti.network/membership/news-following'), { NEWS_KV: {} }, {
    queryItems: bell.queryItems, authorize: async () => ({ ok: true, githubId: '1' }), kv, sourceList: async () => ({ sources: [] }),
  });
  assert.equal(bell.seen[0]?.requireImage, true, 'the bell');
  const digest = recorder();
  await gatherNewsEntries({ NEWS_KV: {} }, { queryItems: digest.queryItems, kv: { get: async () => null }, sourceList: async () => ({ sources: [] }), listOpened: async () => [], nowMs: 1790780000000 });
  assert.equal(digest.seen[0]?.requireImage, true, 'the digest');
});

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the website News page and the homepage list only stories with a picture and drop one whose picture fails', () => {
  for (const f of ['src/components/feeds/FeedView.astro', 'src/pages/index.astro']) {
    const src = read(f);
    assert.doesNotMatch(src, /newsFeatureImage|GENERIC_FEATURE_IMAGE|feature-category\.png/, `${f}: no stand-in image of ours`);
    assert.match(src, /\.filter\(\(it: any\) => it && it\.image\)/, `${f}: a story without a picture is not rendered`);
    assert.match(src, /img\.addEventListener\('error', \(\) => art\.remove\(\), \{ once: true \}\);/, `${f}: a failed picture removes the story`);
  }
});

test('the extension removes a news card whose picture fails, and keeps the glyph for everything else', () => {
  const src = read('client-ui/src/elements/gbti-card-list.mjs');
  assert.match(src, /const card = t\.classList\.contains\('cimg'\) \? t\.closest\('\[data-card\]\[data-type="news"\]'\) : null;/);
  assert.match(src, /if \(card\) \{ \(card\.closest\('\.it'\) \|\| card\)\.remove\(\); return; \}/);
  assert.doesNotMatch(src, /newsFeatureImage|brand\/feature/);
});
