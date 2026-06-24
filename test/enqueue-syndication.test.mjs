// SOW-058 P4: the content-publish enqueue runner. Injected readFile + mention resolver + a fake KV REST fetch
// (Map-backed). Asserts: only a published post/product/prompt is enqueued (drafts + shares excluded), as a PENDING
// item (awaiting superadmin approval), metadata only; a dry-run writes nothing.
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
const SHARE = `---\ntitle: A share\nstatus: published\nauthor: alice\nurl: https://ext.com/x\n---\nx`;

const FILES = {
  'members/alice/posts/x/index.md': POST,
  'members/alice/posts/d/index.md': DRAFT,
  'members/alice/shares/s1.md': SHARE,
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

test('apply enqueues only the published post (draft + share excluded), as a PENDING item', async () => {
  const store = new Map();
  const r = await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: Object.keys(FILES).join(',') }, deps: deps(store) });
  assert.equal(r.enqueued, 1);
  assert.equal(r.inputs.length, 1);
  assert.equal(r.inputs[0].targetSlug, 'members/alice/posts/x');
  const itemKeys = [...store.keys()].filter((k) => k.startsWith('synd:item:'));
  assert.equal(itemKeys.length, 1);
  const item = JSON.parse(store.get(itemKeys[0]));
  assert.equal(item.status, 'pending'); // waits for superadmin approval, never auto-posts
  assert.equal(item.source, 'post');
});

test('dry-run plans but writes nothing to KV', async () => {
  const store = new Map();
  const r = await main({ argv: [], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/posts/x/index.md' }, deps: deps(store) });
  assert.equal(r.enqueued, 0);
  assert.equal(r.inputs.length, 1);
  assert.equal(store.size, 0);
});
