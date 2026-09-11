// The shares feed as one card grid (owner, 2026-09-11): the members-only shares a paid or trial member may read
// are drawn as the SAME card FeedList.astro builds and slotted into the ladder by date. These pin the client
// card's markup against the Astro card (a drift census), the merge plan, and the view wiring that replaced the
// sow-312 member stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { shareCardHtml, planShareMerge, shareSlug, shareReadHref, escapeHtml } from '../src/lib/feed-share-cards.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const NOW = Date.parse('2026-09-11T12:00:00Z');
const members = { id: '20260801120000-abc', author: 'bob', title: 'A <b>bold</b> find', shortDescription: 'Why it matters', url: 'https://www.youtube.com/watch?v=x', image: 'https://cdn/x.jpg', tags: ['Music', ' ai '], visibility: 'members', createdAt: '2026-08-01T12:00:00Z' };
const pub = { id: '20260911110000-def', author: 'alice', title: 'Fresh public one', url: 'https://example.org/p', visibility: 'public', createdAt: '2026-09-11T11:00:00Z', comments: 3 };

test('shareCardHtml: the card carries the feed hooks, the members tag, the escaped title, the reading link and the timestamp', () => {
  const html = shareCardHtml(members, { now: NOW, avatarUrl: (u) => `https://github.com/${u}.png`, fallbackImage: '/fb.png' });
  assert.match(html, /^<article class="feed-item" data-fi data-kind="share" data-author="bob" data-comments="0" data-visibility="members" data-tags="music ai" data-cats="" data-share-slug="bob\/20260801120000-abc" data-ts="1785585600000" data-live-share>/);
  assert.match(html, /<span class="kind-tag kt-share">shared · youtube\.com<\/span><span class="kind-tag kt-members">members<\/span>/);
  assert.match(html, /<h2 class="feed-title"><a href="\/account\/#read=bob%2F20260801120000-abc">A &lt;b&gt;bold&lt;\/b&gt; find<\/a><\/h2>/);
  assert.match(html, /<p class="feed-ex">Why it matters<\/p>/);
  assert.match(html, /<a class="who" href="\/members\/bob\/">@bob<\/a><span class="dotsep"><\/span>1mo ago/);
  assert.match(html, /<img src="https:\/\/github\.com\/bob\.png"/);
  assert.match(html, /<a class="feed-cover" href="\/account\/#read=bob%2F20260801120000-abc"[^>]*><img src="https:\/\/cdn\/x\.jpg"/, 'a real image, no fallback class');
  assert.doesNotMatch(html, /rx-static/, 'no comment count when the item carries none');
  const p = shareCardHtml(pub, { now: NOW, fallbackImage: '/fb.png' });
  assert.match(p, /class="feed-item nocover"[^>]*data-visibility="public"[^>]*data-ts="1789124400000"/);
  assert.doesNotMatch(p, /kt-members/);
  assert.match(p, /<a class="feed-cover feed-cover-fb"[^>]*><img src="\/fb\.png"/, 'the branded fallback keeps the grid rhythm');
  assert.match(p, /<span class="rx rx-static">[\s\S]*?<\/svg> 3<span class="sr-only"> comments<\/span><\/span>/);
  assert.equal(shareSlug({ author: 'a', id: 'b' }), 'a/b'); assert.equal(shareSlug({}), '');
  assert.equal(shareReadHref('a/b'), '/account/#read=a%2Fb');
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('drift census: every class and data-* hook the client card emits exists in the Astro card, the favorite pill and the collection pill', () => {
  const html = shareCardHtml(members, { now: NOW, avatarUrl: (u) => `https://github.com/${u}.png`, fallbackImage: '/fb.png' }) + shareCardHtml(pub, { now: NOW, fallbackImage: '/fb.png' });
  const astro = read('src/components/feeds/FeedList.astro') + read('src/components/FavoriteButton.astro') + read('src/components/CollectionButton.astro');
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  for (const c of classes) assert.ok(astro.includes(c), `class "${c}" is not one the Astro card emits`);
  const hooks = new Set([...html.matchAll(/\s(data-[a-z-]+)(?:=|\s|>)/g)].map((m) => m[1]));
  hooks.delete('data-live-share'); // the one hook the client adds, so a style or a test can tell a live card apart
  for (const h of hooks) assert.ok(astro.includes(h), `hook "${h}" is not one the Astro card emits`);
  // the hooks the view's filters and the favorites bootstrap read must be present on every client card
  for (const must of ['data-fi', 'data-kind="share"', 'data-visibility=', 'data-tags=', 'data-share-slug=', 'data-ts=', 'data-gbti-target-type="share"', 'data-gbti-target-slug=', 'data-signin', 'data-follow-user=']) assert.ok(html.includes(must), must);
  assert.match(read('src/components/feeds/FeedList.astro'), /data-ts=\{it\.date\}/, 'the built card carries the timestamp the merge orders by');
});

test('planShareMerge: drops what the build already has, dedupes, sorts newest first, names the built card each one sits before', () => {
  const existing = [{ slug: 'a/300', ts: 300 }, { slug: 'a/200', ts: 200 }, { slug: 'a/100', ts: 100 }];
  const at = (t) => new Date(t).toISOString();
  const shares = [
    { id: '100', author: 'a', createdAt: at(100) },   // already built
    { id: 'n50', author: 'b', createdAt: at(50) },    // older than everything: after the last card
    { id: 'n250', author: 'b', createdAt: at(250) },  // between 300 and 200
    { id: 'n250', author: 'b', createdAt: at(250) },  // duplicate
    { id: 'n400', author: 'b', createdAt: at(400) },  // newest: before the first card
    { id: null, author: 'b', createdAt: at(400) },    // no slug: dropped
  ];
  const plan = planShareMerge(existing, shares);
  assert.deepEqual(plan.map((p) => [shareSlug(p.share), p.beforeSlug]), [['b/n400', 'a/300'], ['b/n250', 'a/200'], ['b/n50', null]]);
  assert.deepEqual(planShareMerge([], []), []);
  assert.deepEqual(planShareMerge(null, [{ id: '1', author: 'z', createdAt: at(5) }]).map((p) => p.beforeSlug), [null]);
});

test('the view: the member stream mount is gone; the reveal script fetches /membership/shares through the website client and merges cards; the filters re-collect rows', () => {
  const view = read('src/components/feeds/FeedView.astro');
  assert.doesNotMatch(view, /<gbti-shares-feed>/, 'no row-design stream on the feed page');
  assert.doesNotMatch(view, /data-member-stream/);
  assert.match(view, /import \{ mergeSharesIntoFeed \} from '\.\.\/\.\.\/lib\/feed-share-cards\.mjs';/);
  assert.match(view, /const entitled = canReadMemberStream\(s\);/, 'the one tier predicate still decides');
  assert.match(view, /const r = await client\.listShares\(\{ limit: 100 \}\);\s*mergeSharesIntoFeed\(list, r\?\.items \?\? \[\], \{/);
  assert.match(view, /data-feedview data-narrow=\{narrow\} data-view="card"/, 'the view names its narrow');
  assert.match(view, /\[data-feedview\]\[data-narrow="shares"\]/, 'the merge runs on the shares view only');
  assert.match(view, /list\?\.addEventListener\('feed-rows-changed', \(\) => \{ rows = Array\.from\(list\.querySelectorAll<HTMLElement>\('\[data-fi\]'\)\); apply\(\); \}\);/);
  assert.doesNotMatch(view, /setClient\(createWorkbenchClient/, 'no element to feed a client into any more');
});
