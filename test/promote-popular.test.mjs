// SOW-126: the engagement-triggered popular promoter. Pure selectPromotions + engagementKey, and a main() run
// with injected deps (no KV, no fs, no network). Verifies the threshold, the signal gate, the popular-cell
// requirement, the watermark, and the enqueue with trigger:'popular'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPromotions, engagementKey, main } from '../scripts/promote-popular.mjs';
import { syndicationConfigFromParsed, contentEngagement } from '../membership/syndication-config-core.mjs';

const CE = (over = {}) => ({ enabled: true, threshold: 3, tier: 'signed-in', signals: { opens: true, favorites: false, upvotes: false, comments: false }, ...over });
const CFG = (matrix) => syndicationConfigFromParsed({ enabled: true, channels: { discord: true, bluesky: true }, auto_matrix: matrix });

test('engagementKey: content uses the bare slug, a share uses <author>/<id>', () => {
  assert.equal(engagementKey({ type: 'post', slug: 'my-post', author: 'alice' }), 'post:my-post');
  assert.equal(engagementKey({ type: 'share', slug: '20260101-x', author: 'alice' }), 'share:alice/20260101-x');
});

test('selectPromotions: opens at/above the threshold with a popular cell is selected; below is not', () => {
  const cfg = CFG({ share: { bluesky: 'popular' } });
  const items = [{ type: 'share', slug: 'x', author: 'alice', targetSlug: 'members/alice/shares/x', input: {} }];
  const hot = selectPromotions({ items, opens: { 'share:alice/x': 3 }, ce: CE(), cfg });
  assert.equal(hot.length, 1);
  assert.deepEqual(hot[0].channels, ['bluesky']);
  assert.equal(hot[0].engagement, 3);
  const cold = selectPromotions({ items, opens: { 'share:alice/x': 2 }, ce: CE(), cfg });
  assert.equal(cold.length, 0);
});

test('selectPromotions: no popular cell, a watermarked item, or a disabled config -> nothing', () => {
  const items = [{ type: 'post', slug: 'p', author: 'a', targetSlug: 'members/a/posts/p', input: {} }];
  // post defaults on everywhere (no popular cell) -> skipped even at high opens
  assert.equal(selectPromotions({ items, opens: { 'post:p': 99 }, ce: CE(), cfg: CFG({}) }).length, 0);
  const cfg = CFG({ post: { bluesky: 'popular' } });
  // already promoted -> skipped
  assert.equal(selectPromotions({ items, opens: { 'post:p': 5 }, ce: CE(), cfg, promoted: new Set(['members/a/posts/p']) }).length, 0);
  // disabled config -> skipped
  assert.equal(selectPromotions({ items, opens: { 'post:p': 5 }, ce: CE({ enabled: false }), cfg }).length, 0);
});

test('selectPromotions: the signal gate + max-across-signals + upvotes-are-share-only', () => {
  const cfg = CFG({ share: { bluesky: 'popular' }, post: { bluesky: 'popular' } });
  const share = { type: 'share', slug: 'x', author: 'a', targetSlug: 'members/a/shares/x', input: {} };
  const post = { type: 'post', slug: 'p', author: 'a', targetSlug: 'members/a/posts/p', input: {} };
  // opens OFF, favorites ON: the post's favorites drive it; opens are ignored.
  const favOnly = selectPromotions({ items: [post], opens: { 'post:p': 99 }, favorites: { 'post:p': 3 }, ce: CE({ signals: { opens: false, favorites: true } }), cfg });
  assert.equal(favOnly.length, 1);
  // upvotes ON: only the SHARE counts upvotes; a post ignores the upvotes map.
  const up = selectPromotions({ items: [share, post], upvotes: { 'share:a/x': 4, 'post:p': 9 }, ce: CE({ signals: { opens: false, upvotes: true } }), cfg });
  assert.deepEqual(up.map((s) => s.item.type), ['share']);
  // max across enabled signals: neither alone hits 3, but the max does when both are enabled and one reaches it.
  const maxed = selectPromotions({ items: [share], opens: { 'share:a/x': 1 }, favorites: { 'share:a/x': 3 }, ce: CE({ signals: { opens: true, favorites: true } }), cfg });
  assert.equal(maxed.length, 1);
});

test('main(): a disabled config is a clean no-op', async () => {
  const r = await main({ argv: [], deps: { config: syndicationConfigFromParsed({}), paths: [], opens: {} } });
  assert.equal(r.promoted, 0);
  assert.equal(r.reason, 'disabled');
});

test('main() --apply: enqueues a popular item with trigger:popular and watermarks it', async () => {
  const cfg = syndicationConfigFromParsed({ enabled: true, channels: { bluesky: true }, content_engagement: { enabled: true, threshold: 2, signals: { opens: true } }, auto_matrix: { share: { bluesky: 'popular' } } });
  const SHARE = `---\ntitle: Hot Take\nstatus: published\nauthor: alice\nurl: https://ext.com/x\ncategory: devops\n---\nbody`;
  const store = new Map();
  const enqueueFetch = async (url, opts = {}) => {
    const m = /namespaces\/[^/]+\/values\/(.+)$/.exec(url); const key = m ? decodeURIComponent(m[1]) : '';
    if ((opts.method || 'GET') === 'PUT') { store.set(key, String(opts.body)); return { ok: true, status: 200 }; }
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => store.get(key) };
  };
  const r = await main({
    argv: ['--apply'],
    env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' },
    fetchImpl: enqueueFetch, // the watermark write (putKvValue) uses the fake KV too
    deps: {
      config: cfg,
      paths: ['members/alice/shares/x.md'],
      readFile: (rel) => (rel === 'members/alice/shares/x.md' ? SHARE : null),
      opens: { 'share:alice/x': 2 }, // meets the threshold of 2
      promoted: new Set(),
      enqueueFetch,
    },
  });
  assert.equal(r.promoted, 1);
  assert.equal(r.watermarked, 1); // the item is watermarked so it never re-promotes
  const itemKeys = [...store.keys()].filter((k) => k.startsWith('synd:item:'));
  assert.equal(itemKeys.length, 1);
  const item = JSON.parse(store.get(itemKeys[0]));
  assert.equal(item.trigger, 'popular');
  assert.equal(item.source, 'share');
  assert.ok([...store.keys()].some((k) => k.startsWith('popular-promoted:members/alice/shares/x')), 'watermark written');
});
