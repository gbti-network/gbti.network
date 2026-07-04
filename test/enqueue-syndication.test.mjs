// SOW-058 P4 (+ SOW-087): the content-publish enqueue runner. Injected readFile + mention resolver + a fake KV
// REST fetch (Map-backed). Asserts: a published post/product/prompt/SHARE is enqueued (drafts excluded), as a
// PENDING item (awaiting superadmin approval), metadata only, carrying its routing category + moderation flags
// + the author displayName; a dry-run writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, toQueueInput } from '../scripts/enqueue-syndication.mjs';

function fakeKvFetch(store) {
  return async (url, opts = {}) => {
    const m = /namespaces\/[^/]+\/values\/(.+)$/.exec(url);
    const key = m ? decodeURIComponent(m[1]) : '';
    if ((opts.method || 'GET') === 'PUT') { store.set(key, String(opts.body)); return { ok: true, status: 200 }; }
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => store.get(key) };
  };
}

const ENV = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };

const POST = `---\ntitle: My Post\nstatus: published\nvisibility: public\nauthor: alice\nshortDescription: A short blurb.\ncoverImage: https://img/x.jpg\n---\nBody.`;
const DRAFT = `---\ntitle: Draft\nstatus: draft\nauthor: alice\n---\nx`;
const SHARE = `---\ntitle: A share\nstatus: published\nauthor: alice\nurl: https://ext.com/x\ncategory: devops\nshortDescription: A devops find.\n---\nx`;
const PROFILE = `---\ntype: profile\nusername: alice\ndisplayName: "Alice Q"\n---\nHi.`;

const FILES = {
  'members/alice/posts/x/index.md': POST,
  'members/alice/posts/d/index.md': DRAFT,
  'members/alice/shares/s1.md': SHARE,
  'members/alice/profile.md': PROFILE,
};
const deps = (store) => ({
  readFile: (rel) => FILES[rel] ?? null,
  resolveMention: async (author) => `@${author}`,
  enqueueFetch: fakeKvFetch(store),
});

test('toQueueInput maps a published post to a metadata-only queue input (no body)', () => {
  const inp = toQueueInput({
    item: { type: 'post', slug: 'x', author: 'alice', title: 'My Post', visibility: 'public', hasPublicPage: true },
    fm: { shortDescription: 'A short blurb.', coverImage: 'https://img/x.jpg' },
    rel: 'members/alice/posts/x/index.md', mention: '@alice', siteOrigin: 'https://gbti.network',
  });
  assert.equal(inp.source, 'post');
  assert.equal(inp.targetSlug, 'members/alice/posts/x');
  assert.equal(inp.url, 'https://gbti.network/articles/x/');
  assert.equal(inp.blurb, 'A short blurb.');
  assert.equal(inp.image, 'https://img/x.jpg');
  assert.equal(inp.trigger, 'publish');
  assert.ok(!('body' in inp), 'a queue input never carries the body');
});

// SOW-087: a share maps to a queue input carrying its external url, its flat topic category, and no body.
test('toQueueInput maps a published share (external url + category); content takes categories[0]', () => {
  const share = toQueueInput({
    item: { type: 'share', slug: 's1', author: 'alice', title: 'A share', visibility: 'members', hasPublicPage: false, shareUrl: 'https://ext.com/x' },
    fm: { shortDescription: 'A devops find.', category: 'devops' },
    rel: 'members/alice/shares/s1.md', mention: '@alice', siteOrigin: 'https://gbti.network', authorName: 'Alice Q',
  });
  assert.equal(share.source, 'share');
  assert.equal(share.url, 'https://ext.com/x');
  assert.equal(share.category, 'devops');
  assert.equal(share.authorName, 'Alice Q');
  assert.deepEqual(share.flags, []);
  const post = toQueueInput({
    item: { type: 'post', slug: 'x', author: 'alice', title: 'T', visibility: 'public', hasPublicPage: true },
    fm: { categories: ['ai', 'imagegen'] },
    rel: 'members/alice/posts/x/index.md', mention: null, siteOrigin: 'https://gbti.network',
  });
  assert.equal(post.category, 'ai'); // the top-level taxonomy key
});

// SOW-087: the moderation word lists stamp flags from the POSTED surface (title + blurb) only.
test('toQueueInput stamps moderation flags from title + blurb', () => {
  const moderation = { lists: { profanity: ['shit'], political: ['election'] } };
  const flagged = toQueueInput({
    item: { type: 'post', slug: 'x', author: 'alice', title: 'This election take', visibility: 'public', hasPublicPage: true },
    fm: { shortDescription: 'Total shit, honestly.' },
    rel: 'members/alice/posts/x/index.md', mention: null, siteOrigin: 'https://gbti.network', moderation,
  });
  assert.deepEqual(flagged.flags, ['political', 'profanity']);
  const clean = toQueueInput({
    item: { type: 'post', slug: 'y', author: 'alice', title: 'A calm title', visibility: 'public', hasPublicPage: true },
    fm: {}, rel: 'members/alice/posts/y/index.md', mention: null, siteOrigin: 'https://gbti.network', moderation,
  });
  assert.deepEqual(clean.flags, []);
});

test('apply enqueues the published post AND the published share (draft excluded), as PENDING items', async () => {
  const store = new Map();
  const added = ['members/alice/posts/x/index.md', 'members/alice/posts/d/index.md', 'members/alice/shares/s1.md'];
  const r = await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: added.join(',') }, deps: deps(store) });
  assert.equal(r.enqueued, 2);
  assert.deepEqual(r.inputs.map((i) => i.targetSlug).sort(), ['members/alice/posts/x', 'members/alice/shares/s1']);
  const itemKeys = [...store.keys()].filter((k) => k.startsWith('synd:item:'));
  assert.equal(itemKeys.length, 2);
  const items = itemKeys.map((k) => JSON.parse(store.get(k)));
  for (const item of items) assert.equal(item.status, 'pending'); // waits for superadmin approval, never auto-posts
  const share = items.find((i) => i.source === 'share');
  assert.equal(share.url, 'https://ext.com/x'); // the off-network link
  assert.equal(share.category, 'devops');
  assert.equal(share.authorName, 'Alice Q'); // from members/alice/profile.md
  assert.deepEqual(share.flags, []);
});

test('dry-run plans but writes nothing to KV', async () => {
  const store = new Map();
  const r = await main({ argv: [], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/posts/x/index.md' }, deps: deps(store) });
  assert.equal(r.enqueued, 0);
  assert.equal(r.inputs.length, 1);
  assert.equal(store.size, 0);
});
