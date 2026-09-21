// A published share must carry a category (owner, 2026-09-21: "Shares should not make it into being published
// without a category"). The rule is held in membership/share-category.mjs and enforced at the builder every host
// uses, at the Worker's author route, and in validate-content. main has no required status checks, so the CI check
// alone would only complain after an uncategorized share had merged; these tests pin the two layers before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_CATEGORY_REQUIRED, shareCategoryProblem, shareFrontmatterFields, shareFilesCategoryProblem,
} from '../membership/share-category.mjs';
import { validateHostedRequest } from '../membership/hosted-author.mjs';
import { membershipAuthor } from '../workers/signup/membership-author.mjs';
import { TOPICS_MIRROR_KEY } from '../membership/topics-vocab.mjs';

const shareFile = (fm, { path = 'members/atwellpub/shares/20260921000000-x.md', body = 'A note.' } = {}) =>
  ({ path, content: `---\ntype: share\nid: 20260921000000-x\nauthor: atwellpub\n${fm}\ncreatedAt: 2026-09-21T00:00:00.000Z\n---\n${body}\n` });

// ---------- the pure rule ----------

test('only a PUBLISHED share needs a category, and a blank one is no category', () => {
  assert.equal(shareCategoryProblem({ status: 'published', category: 'education' }), null);
  assert.equal(shareCategoryProblem({ status: 'published' }), SHARE_CATEGORY_REQUIRED);
  assert.equal(shareCategoryProblem({ status: 'published', category: '   ' }), SHARE_CATEGORY_REQUIRED);
  assert.equal(shareCategoryProblem({ status: 'draft' }), null, 'a draft publishes nothing');
  assert.equal(shareCategoryProblem({}), null, 'an absent status is a draft (the share schema default)');
});

test('with the topic list in hand, an unknown key is refused; without it, presence is enough', () => {
  const keys = new Set(['education', 'music']);
  assert.equal(shareCategoryProblem({ status: 'published', category: 'music' }, { topicKeys: keys }), null);
  assert.match(shareCategoryProblem({ status: 'published', category: 'history' }, { topicKeys: keys }), /"history" is not one of the network's topics/);
  assert.equal(shareCategoryProblem({ status: 'published', category: 'history' }, { topicKeys: ['education'] }) !== null, true, 'an array works too');
  assert.equal(shareCategoryProblem({ status: 'published', category: 'history' }), null, 'no list: presence only');
  assert.equal(shareCategoryProblem({ status: 'published', category: 'history' }, { topicKeys: [] }), null, 'an empty list is no list');
});

test('the frontmatter reader takes quoted and bare values, and never a body line', () => {
  assert.deepEqual(shareFrontmatterFields('---\nstatus: published\ncategory: education\n---\n'), { status: 'published', category: 'education' });
  assert.deepEqual(shareFrontmatterFields('---\nstatus: "published"\ncategory: \'open-source\'\n---\n'), { status: 'published', category: 'open-source' });
  assert.equal(shareFrontmatterFields('---\nstatus: published\n---\ncategory: education\n').category, undefined,
    'a body line reading category: x must not count as the category');
  assert.equal(shareFrontmatterFields('---\nstatus: published\ncategory:\n---\n').category, '');
  assert.deepEqual(shareFrontmatterFields('no frontmatter'), {});
});

test('a request is refused for a published share file without a category, and only for that', () => {
  assert.equal(shareFilesCategoryProblem([shareFile('status: published')]), SHARE_CATEGORY_REQUIRED);
  assert.equal(shareFilesCategoryProblem([shareFile('status: published\ncategory: education')]), null);
  assert.equal(shareFilesCategoryProblem([shareFile('status: draft')]), null, 'a draft share');
  assert.equal(shareFilesCategoryProblem([{ path: 'members/atwellpub/shares/x.md', content: null }]), null, 'a delete publishes nothing');
  assert.equal(shareFilesCategoryProblem([shareFile('status: published', { path: 'members/atwellpub/posts/x/index.md' })]), null,
    'an article is not a share (it has categories, a different rule)');
  assert.equal(shareFilesCategoryProblem([shareFile('status: published', { path: 'house/shares/x.md' })]), SHARE_CATEGORY_REQUIRED, 'house shares too');
});

// ---------- the Worker's validator ----------

test('validateHostedRequest refuses a published share without a category and admits one with it', () => {
  const base = { itemId: 'share-20260921000000-x', folder: 'atwellpub' };
  const bad = validateHostedRequest({ ...base, files: [shareFile('status: published')] });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.equal(bad.error, SHARE_CATEGORY_REQUIRED);
  assert.equal(validateHostedRequest({ ...base, files: [shareFile('status: published\ncategory: education')] }).ok, true);
  const unknown = validateHostedRequest({ ...base, files: [shareFile('status: published\ncategory: history')], topicKeys: ['education'] });
  assert.equal(unknown.ok, false, 'an unknown key is refused when the caller passes the topic list');
});

// ---------- the author route, which reads the topic list from KV ----------

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
function kvWith(entries = {}) {
  const m = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  return { async get(k, t) { const v = m.get(k); if (v == null) return null; return t === 'json' || t?.type === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
function gh() {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/members-index\.yml\?ref=main$/.test(url)) return { ok: true, status: 200, async json() { return { content: b64('members:\n  "2002207": atwellpub\n') }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    if (/\/contents\//.test(url) && method === 'PUT') return { ok: true, status: 201, async json() { return {}; } };
    if (/\/pulls$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://github.com/x/y/pull/42' }; } };
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const post = (files, kv) => membershipAuthor(
  { headers: { get: () => 'Bearer tok' }, json: async () => ({ itemId: 'share-20260921000000-x', title: 'New Share', files }) },
  env,
  {
    fetchImpl: gh(), fetchUser: async () => ({ githubLogin: 'atwellpub', githubId: '2002207' }),
    authorize: async () => ({ ok: true, githubId: '2002207', tier: 'member' }),
    authorizeSuper: async () => ({ ok: false, status: 403 }), kv, signJwt: async () => 'fake.jwt.sig',
  },
);
const TOPICS = { topics: { education: { label: 'Education' }, music: { label: 'Music' } } };

test('the author route refuses a published share with no category', async () => {
  const res = await post([shareFile('status: published\nvisibility: members')], kvWith({ [TOPICS_MIRROR_KEY]: TOPICS }));
  assert.equal(res.status, 400);
  assert.equal(res.body.message, SHARE_CATEGORY_REQUIRED);
});

test('the author route refuses a category that is not a topic, using the mirrored topic list', async () => {
  const res = await post([shareFile('status: published\ncategory: history\nvisibility: members')], kvWith({ [TOPICS_MIRROR_KEY]: TOPICS }));
  assert.equal(res.status, 400);
  assert.match(res.body.message, /"history" is not one of the network's topics/);
});

test('the author route accepts a real category, and falls back to presence when the topic list is unreadable', async () => {
  const good = await post([shareFile('status: published\ncategory: music\nvisibility: members')], kvWith({ [TOPICS_MIRROR_KEY]: TOPICS }));
  assert.equal(good.status, 200, `a categorized share must pass the category rule: ${JSON.stringify(good.body)}`);
  const noMirror = await post([shareFile('status: published\ncategory: history\nvisibility: members')], kvWith({}));
  assert.equal(noMirror.status, 200, `with no topic list, a present category passes: ${JSON.stringify(noMirror.body)}`);
});
