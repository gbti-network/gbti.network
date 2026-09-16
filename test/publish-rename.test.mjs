// SOW-112 v2: the publish-event rename (owner-directed stage-first flow). saveDraft stages a slug change under
// the item's OLD identity; publish performs the move (deletes + intro move + redirectFrom merge + preserved
// publishedAt); a plain re-publish with `path` keeps existing redirectFrom; a pathless publish is untouched.
//
// sow-274 Part 2: every write goes to the network now, so these assert on the file set that REACHES the network
// (POST /membership/author) and on the staged record (POST /membership/drafts), not on writes to a fake fork.
// The fork-only cases (fork sync, branch rebuild, the open-PR block on a fork branch) went with the fork path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publish, saveDraft, renameOriginOf, OperationError } from '../client/src/operations.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';

const OLD = 'members/alice/prompts/old-name/index.md';
const OLD_FM = '---\ntype: prompt\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02T00:00:00.000Z\nshortDescription: about it\ntargets:\n  - Claude Code\ncategories:\n  - skill\nredirectFrom:\n  - "/devops/legacy-wp-path/"\n---\n\nOld body.\n';
const INPUT = {
  title: 'X', slug: 'old-name', shortDescription: 'about it', targets: ['Claude Code'],
  categories: ['skill'], visibility: 'public', publishedAt: '2026-07-06T09:00:00.000Z', updatedAt: '2026-07-06T09:00:00.000Z',
};

/** The canonical-repo read client. Reads only: a publish that reached for any fork writer would throw here. */
function fakeRepo({ upstreamFiles = {} } = {}) {
  return {
    upstream: 'gbti-network/gbti.network',
    async getFileContent(p) { return upstreamFiles[p] ?? null; },
  };
}

/** The network: records every author call (the file set that would be committed) and every staged-draft write. */
function network({ drafts = [] } = {}) {
  const authored = [];
  const draftWrites = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    if (path === '/membership/author') {
      authored.push(body);
      return ok({ ok: true, number: 7, html_url: 'u', branch: `hosted/1/${body.itemId}` });
    }
    if (path === '/membership/drafts') {
      if (!body) return ok({ ok: true, drafts });
      draftWrites.push(body);
      return ok({ ok: true });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const files = () => authored.flatMap((a) => a.files);
  return {
    fetch, authored, draftWrites,
    puts: () => files().filter((f) => f.content != null),
    deletes: () => files().filter((f) => f.content == null).map((f) => f.path),
    staged: () => draftWrites.filter((w) => w.op === 'put').map((w) => w.draft),
  };
}

function ctxFor({ repo = fakeRepo(), net = network(), files = {} } = {}) {
  const all = { [OLD]: OLD_FM, ...files };
  return {
    identity: () => ({ username: 'alice' }),
    getRepoClient: () => repo,
    membership: async () => 'paid',
    reader: { readFile: async (rel) => all[rel] ?? null },
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    fetch: net.fetch,
  };
}
const fmOf = (net, path) => parseContentFile(net.puts().find((f) => f.path === path).content).frontmatter;

test('renameOriginOf: own item of the same type only', () => {
  assert.deepEqual(renameOriginOf({ path: OLD, username: 'alice', type: 'prompt' }), { oldSlug: 'old-name', oldPath: OLD });
  assert.equal(renameOriginOf({ path: OLD, username: 'bob', type: 'prompt' }), null);
  assert.equal(renameOriginOf({ path: OLD, username: 'alice', type: 'post' }), null);
  assert.equal(renameOriginOf({ path: 'house/prompts/x/index.md', username: 'alice', type: 'prompt' }), null);
  assert.equal(renameOriginOf({ username: 'alice', type: 'prompt' }), null);
});

test('publish with a changed slug performs the rename under the old-slug identity', async () => {
  const net = network();
  const intro = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: prompt\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nHi.\n';
  const ctx = ctxFor({ net, files: { 'members/alice/comments/intro-old-name.md': intro } });
  const res = await publish(ctx, { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'New body.', path: OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const fm = fmOf(net, 'members/alice/prompts/new-name/index.md');
  assert.equal(fm.slug, 'new-name');
  // redirectFrom = the old file's legacy entry + the rename-generated old URL
  assert.deepEqual([...fm.redirectFrom].sort(), ['/devops/legacy-wp-path/', '/prompts/old-name/'].sort());
  // publishedAt preserved from the OLD file (the editor stamped now; the server restores the original)
  assert.equal(new Date(fm.publishedAt).toISOString(), '2026-07-02T00:00:00.000Z');
  // the old index deletes; the intro moved + retargeted, all in ONE network commit
  assert.equal(net.authored.length, 1);
  assert.ok(net.deletes().includes(OLD));
  assert.ok(net.deletes().includes('members/alice/comments/intro-old-name.md'));
  const movedIntro = net.puts().find((f) => f.path === 'members/alice/comments/intro-new-name.md');
  assert.equal(parseContentFile(movedIntro.content).frontmatter.targetSlug, 'new-name');
  // the change rides the ITEM's identity (old slug), so a staged rename draft and the publish share one item
  assert.equal(net.authored[0].itemId, 'prompt-old-name');
});

test('publish rename guards: collision on the new path; fail-closed when the old file vanishes from the network', async () => {
  const collide = network();
  await assert.rejects(
    publish(ctxFor({ net: collide, repo: fakeRepo({ upstreamFiles: { 'members/alice/prompts/new-name/index.md': 'x' } }) }),
      { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD }),
    (e) => e instanceof OperationError && /already taken/.test(e.message));
  assert.equal(collide.authored.length, 0);
  // The old file was readable when the edit was loaded and is gone by the time the move is assembled: the delete
  // half has nothing to delete, so the publish refuses rather than shipping a half-move.
  const net = network();
  const ctx = ctxFor({ net });
  let reads = 0;
  ctx.reader = { readFile: async (rel) => (rel === OLD && reads++ === 0 ? OLD_FM : null) };
  await assert.rejects(
    publish(ctx, { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD }),
    (e) => /could not be found on the network/.test(e.message));
  assert.equal(net.authored.length, 0); // never a half-move
});

test('a plain re-publish with path preserves the old redirectFrom (no rename)', async () => {
  const net = network();
  const res = await publish(ctxFor({ net }), { type: 'prompt', input: { ...INPUT }, body: 'Edited.', path: OLD });
  assert.equal(res.renamed, undefined);
  const fm = fmOf(net, OLD);
  assert.deepEqual(fm.redirectFrom, ['/devops/legacy-wp-path/']); // previously silently dropped
  assert.deepEqual(net.deletes(), []);
  // a plain re-publish keeps the editor's re-surface stamp (only a rename preserves the old date)
  assert.equal(new Date(fm.publishedAt).toISOString(), '2026-07-06T09:00:00.000Z');
});

test('a pathless publish (new item) is untouched by the rename machinery', async () => {
  const net = network();
  const res = await publish(ctxFor({ net }), { type: 'prompt', input: { ...INPUT, slug: 'fresh' }, body: 'B.' });
  assert.equal(res.renamed, undefined);
  assert.ok(net.puts().some((f) => f.path === 'members/alice/prompts/fresh/index.md'));
  assert.deepEqual(net.deletes(), []);
});

test('saveDraft with a changed slug stages under the OLD identity (pending rename)', async () => {
  const net = network();
  const res = await saveDraft(ctxFor({ net }), { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD });
  assert.equal(res.branch, 'gbti/prompt-old-name'); // the ITEM's identity, not a silent fork under the new slug
  assert.equal(res.path, OLD);                       // staged at the old path; the frontmatter slug is the marker
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const [staged] = net.staged();
  assert.equal(staged.slug, 'old-name');
  assert.equal(staged.pendingSlug, 'new-name');
  assert.equal(staged.path, OLD);
  assert.equal(staged.frontmatter.slug, 'new-name');
  assert.equal(net.authored.length, 0, 'a draft never reaches the repository');
});

test('saveDraft without a slug change stages normally under its own slug', async () => {
  const net = network();
  const res = await saveDraft(ctxFor({ net }), { type: 'prompt', input: { ...INPUT }, body: 'B.', path: OLD });
  assert.equal(res.branch, 'gbti/prompt-old-name');
  assert.equal(res.renamed, undefined);
  assert.equal(net.staged()[0].pendingSlug, null);
});

// A staged record as saveDraft writes it for a pending rename: the old identity, the new slug in the frontmatter.
const pendingRecord = (fm = {}) => ({
  type: 'prompt', slug: 'old-name', pendingSlug: 'new-name', path: OLD,
  frontmatter: { ...INPUT, slug: 'new-name', ...fm }, body: 'Staged body.',
});

test('publishDraft routes a pending-rename draft through the full rename publish (never a half-rename)', async () => {
  const { publishDraft } = await import('../client/src/operations.mjs');
  const net = network({ drafts: [pendingRecord()] });
  const res = await publishDraft(ctxFor({ net }), { type: 'prompt', slug: 'old-name' });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  assert.ok(net.puts().some((f) => f.path === 'members/alice/prompts/new-name/index.md'));
  assert.ok(net.deletes().includes(OLD)); // the move shipped, not a file at the old path carrying the new slug
  assert.equal(net.authored[0].itemId, 'prompt-old-name');
  assert.ok(net.draftWrites.some((w) => w.op === 'delete' && w.slug === 'old-name'), 'the staged record is cleared');
});

test('publishDraft without a pending rename publishes the staged item in place', async () => {
  const { publishDraft } = await import('../client/src/operations.mjs');
  const net = network({ drafts: [{ type: 'prompt', slug: 'old-name', pendingSlug: null, path: OLD, frontmatter: { ...INPUT }, body: 'Staged body.' }] });
  const res = await publishDraft(ctxFor({ net }), { type: 'prompt', slug: 'old-name' });
  assert.equal(res.renamed, undefined);
  assert.deepEqual(net.deletes(), []);
  assert.equal(net.puts().find((f) => f.path === OLD).content.includes('Staged body.'), true);
  assert.equal(net.authored[0].itemId, 'prompt-old-name');
});

// Removed by sow-274 Part 2: the stale-draft-branch recovery (direct fork sync + branch rebuild), the
// unconditional branch rebuild, the fork-sync fail-closed case and the open-PR block on a fork branch. Each
// existed only because a fork branch bases on a stale main; the network commits on live main.

test('publishDraft rename routing forces status published (a staged draft may carry status draft)', async () => {
  const { publishDraft } = await import('../client/src/operations.mjs');
  const net = network({ drafts: [pendingRecord({ status: 'draft' })] });
  const res = await publishDraft(ctxFor({ net }), { type: 'prompt', slug: 'old-name' });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const fm = fmOf(net, 'members/alice/prompts/new-name/index.md');
  assert.equal(fm.status, 'published'); // PR #67 landed status: draft without this
});

// PR #68 residual: the editor prefills the author note from the existing intro, so a rename publish writes a
// FRESH intro at the new slug — the OLD intro must still be deleted, or it orphans (a duplicate author note
// via the alias union).
test('rename with a fresh authorNote intro still deletes the old intro', async () => {
  const net = network();
  const intro = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: prompt\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nHi.\n';
  const ctx = ctxFor({ net, files: { 'members/alice/comments/intro-old-name.md': intro } });
  const res = await publish(ctx, { type: 'prompt', input: { ...INPUT, slug: 'new-name' }, body: 'B.', path: OLD, authorNote: 'A fresh intro note.' });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  assert.ok(net.puts().some((f) => f.path === 'members/alice/comments/intro-new-name.md')); // the fresh intro
  assert.ok(net.deletes().includes('members/alice/comments/intro-old-name.md')); // the old one still deletes
});

// SOW-100 Phase 0.5 (owner ask): the rename machinery was only E2E-tested on prompts. Prove POST + PRODUCT
// parity through the same publish-time flow, including the type seams: a post has NO intro comment (none
// required, none moved), a product's intro moves like a prompt's and its pricing fields round-trip, and each
// type's URL base lands in redirectFrom.
const POST_OLD = 'members/alice/posts/old-name/index.md';
const POST_FM = '---\ntype: post\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02T00:00:00.000Z\nexcerpt: about it\ncategories:\n  - devops\n---\n\nOld body.\n';
const POST_INPUT = { title: 'X', slug: 'old-name', excerpt: 'about it', categories: ['devops'], visibility: 'public', publishedAt: '2026-07-07T09:00:00.000Z', updatedAt: '2026-07-07T09:00:00.000Z' };

test('POST rename parity: full move, /articles/ base, and NO intro machinery', async () => {
  const net = network();
  const reads = [];
  const ctx = ctxFor({ net, files: { [POST_OLD]: POST_FM } });
  const innerRead = ctx.reader.readFile;
  ctx.reader = { readFile: async (rel) => { reads.push(rel); return innerRead(rel); } };
  const res = await publish(ctx, { type: 'post', input: { ...POST_INPUT, slug: 'new-name' }, body: 'B.', path: POST_OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const fm = fmOf(net, 'members/alice/posts/new-name/index.md');
  assert.deepEqual(fm.redirectFrom, ['/articles/old-name/']); // the POST url base
  assert.equal(new Date(fm.publishedAt).toISOString(), '2026-07-02T00:00:00.000Z');
  assert.ok(net.deletes().includes(POST_OLD));
  assert.equal(net.authored[0].itemId, 'post-old-name');
  assert.ok(!reads.some((r) => r.includes('/comments/intro-')), 'a post rename must not touch intro comments');
  assert.ok(!net.deletes().some((d) => d.includes('/comments/')), 'no comment deletes for a post');
});

const PROD_OLD = 'members/alice/projects/old-name/index.md';
const PROD_FM = '---\ntype: product\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02T00:00:00.000Z\nshortDescription: about it\nicon: ./images/icon.png\nfeaturedImage: ./images/feat.png\npricing: paid\npricingUrl: https://example.com/buy\ncategories:\n  - devops\n---\n\nOld body.\n';
const PROD_INPUT = {
  title: 'X', slug: 'old-name', shortDescription: 'about it', icon: './images/icon.png',
  featuredImage: './images/feat.png', pricing: 'paid', pricingUrl: 'https://example.com/buy',
  categories: ['devops'], visibility: 'public', publishedAt: '2026-07-07T09:00:00.000Z', updatedAt: '2026-07-07T09:00:00.000Z',
};

test('PRODUCT rename parity: full move, /projects/ base, intro moves, pricing round-trips', async () => {
  const net = network();
  const intro = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: product\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nHi.\n';
  const ctx = ctxFor({ net, files: { [PROD_OLD]: PROD_FM, 'members/alice/comments/intro-old-name.md': intro } });
  const res = await publish(ctx, { type: 'project', input: { ...PROD_INPUT, slug: 'new-name' }, body: 'B.', path: PROD_OLD });
  assert.deepEqual(res.renamed, { from: 'old-name', to: 'new-name' });
  const fm = fmOf(net, 'members/alice/projects/new-name/index.md');
  assert.deepEqual(fm.redirectFrom, ['/projects/old-name/']); // the PRODUCT url base
  assert.equal(fm.pricing, 'paid');
  assert.equal(fm.pricingUrl, 'https://example.com/buy'); // commerce fields survive the move
  const movedIntro = net.puts().find((f) => f.path === 'members/alice/comments/intro-new-name.md');
  assert.equal(parseContentFile(movedIntro.content).frontmatter.targetSlug, 'new-name');
  assert.ok(net.deletes().includes(PROD_OLD));
  assert.ok(net.deletes().includes('members/alice/comments/intro-old-name.md'));
});

test('saveDraft rename staging parity for post + product (old path, old-slug identity)', async () => {
  for (const [type, oldPath, fm, input] of [
    ['post', POST_OLD, POST_FM, POST_INPUT],
    ['project', PROD_OLD, PROD_FM, PROD_INPUT],
  ]) {
    const net = network();
    const res = await saveDraft(ctxFor({ net, files: { [oldPath]: fm } }), { type, input: { ...input, slug: 'renamed-x' }, body: 'B.', path: oldPath });
    assert.equal(res.branch, `gbti/${type}-old-name`);
    assert.equal(res.path, oldPath);
    assert.deepEqual(res.renamed, { from: 'old-name', to: 'renamed-x' });
    assert.equal(net.staged()[0].path, oldPath);
    assert.equal(net.staged()[0].pendingSlug, 'renamed-x');
  }
});

// 2026-07-09: date parity with the WorkBench editor. The MCP/API publish path never stamped
// publishedAt, so an add_* item landed dateless (bottom of every feed, no date chip: the /ci prompt).
test('publish stamps publishedAt for a NEW item; preserves it (+ bumps updatedAt) on a re-publish', async () => {
  const FRESH = 'members/alice/prompts/fresh/index.md';
  // New item (no prior file anywhere): publishedAt stamped.
  const netA = network();
  await publish(ctxFor({ net: netA }), { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd' }, body: 'B' });
  const fmNew = fmOf(netA, FRESH);
  assert.ok(fmNew.publishedAt, 'a new publish carries publishedAt');
  assert.ok(!fmNew.updatedAt, 'a first publish has no updatedAt');

  // Re-publish of an existing item WITHOUT a path param (the MCP add_* shape): the canonical file's
  // publishedAt is preserved and updatedAt bumps.
  const existing = '---\ntype: prompt\ntitle: Fresh\nslug: fresh\nauthor: alice\nstatus: published\nvisibility: public\nshortDescription: d\npublishedAt: 2026-07-01T00:00:00.000Z\n---\n\nOld body.\n';
  const netB = network();
  await publish(ctxFor({ net: netB, files: { [FRESH]: existing } }),
    { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd' }, body: 'B2' });
  const fmUp = fmOf(netB, FRESH);
  assert.match(String(fmUp.publishedAt instanceof Date ? fmUp.publishedAt.toISOString() : fmUp.publishedAt), /^2026-07-01/);
  assert.ok(fmUp.updatedAt, 'a re-publish bumps updatedAt');

  // The MCP host has no working reader: the repo client's canonical read preserves the date instead.
  const netD = network();
  const ctxNoReader = { ...ctxFor({ net: netD, repo: fakeRepo({ upstreamFiles: { [FRESH]: existing } }) }), reader: {} };
  await publish(ctxNoReader, { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd' }, body: 'B3' });
  const viaRepo = fmOf(netD, FRESH);
  assert.match(String(viaRepo.publishedAt instanceof Date ? viaRepo.publishedAt.toISOString() : viaRepo.publishedAt), /^2026-07-01/);

  // An explicit caller publishedAt always wins (never overwritten).
  const netC = network();
  await publish(ctxFor({ net: netC }), { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd', publishedAt: '2026-06-01T00:00:00.000Z' }, body: 'B' });
  const explicit = fmOf(netC, FRESH);
  assert.match(String(explicit.publishedAt instanceof Date ? explicit.publishedAt.toISOString() : explicit.publishedAt), /^2026-06-01/);
});

// 2026-08-26: the /grok prompt showed its DRAFT date, not its publish time. A draft can land on the canonical
// repo as `status: draft` (a staged/held publish), and its draft-time publishedAt is an artifact, not a real
// publication moment: the FIRST true publish must stamp now, or the feed sorts it by a date it was never live.
test('publish stamps publishedAt to now for the FIRST publish of a prior canonical draft', async () => {
  const draftPrior = '---\ntype: prompt\ntitle: Fresh\nslug: fresh\nauthor: alice\nstatus: draft\nvisibility: public\nshortDescription: d\npublishedAt: 2026-01-01T00:00:00.000Z\n---\n\nDraft body.\n';
  const startIso = new Date().toISOString();
  const net = network();
  await publish(ctxFor({ net, files: { 'members/alice/prompts/fresh/index.md': draftPrior } }),
    { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd' }, body: 'B4' });
  const fm = fmOf(net, 'members/alice/prompts/fresh/index.md');
  const iso = String(fm.publishedAt instanceof Date ? fm.publishedAt.toISOString() : fm.publishedAt);
  assert.ok(!iso.startsWith('2026-01-01'), 'the draft-time publishedAt is not surfaced as the publication date');
  assert.ok(iso >= startIso, 'the first publish of a draft stamps publishedAt to now');
  assert.ok(!fm.updatedAt, 'the first publish of a draft is not an edit (no updatedAt)');
  assert.equal(fm.status, 'published', 'publish forces status published');
});

// SOW-258 (hit live 2026-08-18, the /qa prompt): a faithful re-publish round-trips the existing frontmatter,
// which INCLUDES publishedAt. The old `!effInput.publishedAt` outer guard then skipped the whole date block, so
// updatedAt never bumped and DeployStatusNotice + the "Recently updated" sort silently went stale. A re-publish
// that SUPPLIES publishedAt must still stamp updatedAt to now, while preserving the supplied publishedAt.
test('re-publish that SUPPLIES publishedAt still bumps updatedAt (SOW-258)', async () => {
  const existing = '---\ntype: prompt\ntitle: Fresh\nslug: fresh\nauthor: alice\nstatus: published\nvisibility: public\nshortDescription: d\npublishedAt: 2026-07-01T00:00:00.000Z\n---\n\nOld body.\n';
  const startIso = new Date().toISOString();
  const net = network();
  await publish(ctxFor({ net, files: { 'members/alice/prompts/fresh/index.md': existing } }),
    { type: 'prompt', input: { title: 'Fresh', slug: 'fresh', shortDescription: 'd', publishedAt: '2026-07-01T00:00:00.000Z' }, body: 'B2' });
  const fm = fmOf(net, 'members/alice/prompts/fresh/index.md');
  const pub = String(fm.publishedAt instanceof Date ? fm.publishedAt.toISOString() : fm.publishedAt);
  assert.match(pub, /^2026-07-01/, 'the supplied publishedAt is preserved (not re-stamped)');
  assert.ok(fm.updatedAt, 'a re-publish that round-trips publishedAt still bumps updatedAt');
  const upd = String(fm.updatedAt instanceof Date ? fm.updatedAt.toISOString() : fm.updatedAt);
  assert.ok(upd >= startIso, 'updatedAt is stamped to now');
});
