// SOW-082 + SOW-157: the universal draft-staging operations. A draft is staged in the member's private store on
// the network (POST /membership/drafts), never in the canonical repo. Save stages (trial+paid); Publish sends the
// item through the normal publish (paid-only) and drops the staged record. Tested against a fake network.
//
// sow-274 Part 2: drafts used to be committed to a per-item branch of the member's own copy of the repository.
// That path is retired, so these tests assert what reaches the network instead of what a fake fork recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, listDrafts, readDraft, discardDraft, publishDraft, OperationError } from '../client/src/operations.mjs';

/**
 * A ctx whose fetch plays the network. `drafts` seeds the private store (records keyed type:slug);
 * `repoDrafts` is the committed repo-drafts listing, or undefined for a failing route (the fail-soft case).
 * Every call is recorded in `calls.net` as { method, path, body }, and every repository write the old path
 * could make would land in `calls.fork`, which must stay empty.
 */
function draftCtx({ membership = 'paid', drafts = [], repoDrafts } = {}) {
  const calls = { net: [], fork: [] };
  const store = new Map(drafts.map((d) => [`${d.type}:${d.slug}`, d]));
  const ctx = {
    calls,
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    membership: () => membership,
    reader: { readFile: async () => null },
    // Reads of the public repo are allowed (publish falls back to one for a prior version); anything else the
    // repo client offers is a write, and is recorded so a test can prove none happened.
    getRepoClient: () => new Proxy({ upstream: 'gbti-network/gbti.network', getFileContent: async () => null }, {
      get(target, key) {
        if (key in target) return target[key];
        return async () => { calls.fork.push(String(key)); return null; };
      },
    }),
    fetch: async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      calls.net.push({ method, path, body });
      const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
      if (path === '/membership/drafts') {
        if (method === 'GET') return json(200, { ok: true, drafts: [...store.values()] });
        if (body?.op === 'put') { store.set(`${body.draft.type}:${body.draft.slug}`, body.draft); return json(200, { ok: true }); }
        if (body?.op === 'delete') { store.delete(`${body.type}:${body.slug}`); return json(200, { ok: true }); }
      }
      if (path === '/membership/repo-drafts') {
        return repoDrafts === undefined ? json(503, { error: 'unavailable' }) : json(200, { ok: true, items: repoDrafts, sha: 'c0ffee' });
      }
      if (path === '/membership/author') return json(200, { ok: true, branch: `hosted/1/${body.itemId}`, number: 99, html_url: 'pr-url' });
      return json(404, { error: 'not_found' });
    },
  };
  return ctx;
}
const netTo = (ctx, path) => ctx.calls.net.filter((c) => c.path === path);
// A stored record carries the whole built frontmatter, slug included (saveDraft stores it that way).
const rec = (slug, frontmatter, extra = {}) => ({ type: 'post', slug, path: `members/alice/posts/${slug}/index.md`, frontmatter: { slug, ...frontmatter }, body: 'Body', ...extra });

test('saveDraft: a TRIAL member stages to the private store and NEVER opens a PR', async () => {
  const ctx = draftCtx({ membership: 'trialing' });
  const out = await saveDraft(ctx, { type: 'post', input: { title: 'Hello', slug: 'my-post' }, body: 'Body' });
  assert.equal(out.state, 'staged');
  assert.equal(out.branch, 'gbti/post-my-post');
  const puts = netTo(ctx, '/membership/drafts').filter((c) => c.body?.op === 'put');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.draft.slug, 'my-post');
  assert.equal(puts[0].body.draft.body, 'Body');
  assert.equal(netTo(ctx, '/membership/author').length, 0, 'Save must never publish');
  assert.deepEqual(ctx.calls.fork, [], 'Save must never touch a repository');
});

test('saveDraft: free/lapsed/banned are forbidden to stage; unknown fails OPEN', async () => {
  for (const m of ['none', 'expired', 'cancelled', 'banned']) {
    const ctx = draftCtx({ membership: m });
    await assert.rejects(
      () => saveDraft(ctx, { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' }),
      (e) => { assert.ok(e instanceof OperationError); assert.equal(e.code, 'forbidden'); return true; },
    );
    assert.deepEqual(ctx.calls.net, [], `${m}: a refused save still reached the network`);
  }
  const out = await saveDraft(draftCtx({ membership: 'unknown' }), { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' });
  assert.equal(out.state, 'staged'); // unknown -> fail open
});

// sow-274 Part 2 removed enumerating fork branches and skipping share/comment branches: the store holds only drafts.
test('listDrafts: lists the staged records as rows with no pull request', async () => {
  const ctx = draftCtx({ drafts: [rec('my-post', { title: 'My Post', status: 'published', visibility: 'public' })] });
  const { drafts } = await listDrafts(ctx, {});
  assert.equal(drafts.length, 1);
  const p = drafts[0];
  assert.equal(p.slug, 'my-post');
  assert.equal(p.title, 'My Post');
  assert.equal(p.branch, 'gbti/post-my-post');
  assert.equal(p.store, 'kv');
  assert.equal(p.pull, null); // drafts never open a PR -> the UI renders this as Staged
});

test('listDrafts: a type filter narrows to that content type', async () => {
  const ctx = draftCtx({ drafts: [
    rec('my-post', { title: 'P' }),
    { type: 'prompt', slug: 'a-prompt', path: 'members/alice/prompts/a-prompt/index.md', frontmatter: { title: 'Q' }, body: 'x' },
  ] });
  const { drafts } = await listDrafts(ctx, { type: 'post' });
  assert.deepEqual(drafts.map((d) => d.type), ['post']);
});

test('readDraft: returns the staged frontmatter + body for the editor prefill', async () => {
  const ctx = draftCtx({ drafts: [rec('my-post', { title: 'My Post' }, { body: 'The body text' })] });
  const out = await readDraft(ctx, { type: 'post', slug: 'my-post' });
  assert.equal(out.frontmatter.title, 'My Post');
  assert.equal(out.body, 'The body text');
  assert.equal(out.branch, 'gbti/post-my-post');
  await assert.rejects(readDraft(ctx, { type: 'post', slug: 'nope' }), (e) => e.code === 'not-found');
});

// sow-274 Part 2 removed refusing a discard with an open PR: a staged draft has no pull request to strand.
test('discardDraft: deletes the staged record, and is idempotent', async () => {
  const ctx = draftCtx({ drafts: [rec('my-post', { title: 'P' })] });
  const out = await discardDraft(ctx, { type: 'post', slug: 'my-post' });
  assert.equal(out.branch, 'gbti/post-my-post');
  const dels = netTo(ctx, '/membership/drafts').filter((c) => c.body?.op === 'delete');
  assert.deepEqual(dels.map((c) => c.body), [{ op: 'delete', type: 'post', slug: 'my-post' }]);
  const again = await discardDraft(ctx, { type: 'post', slug: 'my-post' });
  assert.equal(again.ok, true, 'discarding a record that is already gone is still the discarded state');
  assert.deepEqual(ctx.calls.fork, []);
});

test('publishDraft: a trial member is blocked; a paid member publishes through the network and drops the record', async () => {
  const trial = draftCtx({ membership: 'trialing', drafts: [rec('my-post', { title: 'Hello' })] });
  await assert.rejects(
    () => publishDraft(trial, { type: 'post', slug: 'my-post' }),
    (e) => {
      assert.equal(e.code, 'membership-required');
      // The draft's own refusal, which tells the member their draft is safe. publish() refuses too, with a
      // different sentence, so asserting the code alone would pass with this gate deleted.
      assert.match(e.message, /Your draft is saved privately/);
      return true;
    },
  );
  assert.equal(netTo(trial, '/membership/author').length, 0, 'a blocked publish sent the item anyway');
  assert.equal(netTo(trial, '/membership/drafts').length, 0, 'the refusal should come before the store is even read');

  const paid = draftCtx({ membership: 'paid', drafts: [rec('my-post', { title: 'Hello' })] });
  const out = await publishDraft(paid, { type: 'post', slug: 'my-post' });
  assert.equal(out.prNumber, 99);
  const authored = netTo(paid, '/membership/author');
  assert.equal(authored.length, 1);
  assert.equal(authored[0].body.itemId, 'post-my-post');
  assert.ok(authored[0].body.files.some((f) => f.path === 'members/alice/posts/my-post/index.md'));
  const dels = netTo(paid, '/membership/drafts').filter((c) => c.body?.op === 'delete' && c.body.slug === 'my-post');
  assert.ok(dels.length >= 1, 'the staged record must be dropped once the item is on the network');
  assert.deepEqual(paid.calls.fork, []);
});

test('publishDraft: a draft that is not in the store is not-found, and nothing is published', async () => {
  const ctx = draftCtx({ membership: 'paid' });
  await assert.rejects(publishDraft(ctx, { type: 'post', slug: 'ghost' }), (e) => e.code === 'not-found');
  assert.equal(netTo(ctx, '/membership/author').length, 0);
});

// sow-274 Part 2 removed reusing an already-open fork PR: the network reuses its own branch and PR per item.

test('publishDraft clears the record it was asked to publish, even when publish() would sweep a different slug', async () => {
  // A record with a pending rename but no stored path cannot be renamed (the old path is unknown), so it publishes
  // under its NEW slug, and publish() clears the record for that slug. The record the member actually had is the
  // one under the OLD slug; only publishDraft's own delete removes it, or it lingers as "not published yet".
  const legacy = { type: 'post', slug: 'old-name', pendingSlug: 'new-name', frontmatter: { slug: 'new-name', title: 'Hello' }, body: 'Body' };
  const ctx = draftCtx({ membership: 'paid', drafts: [legacy] });
  await publishDraft(ctx, { type: 'post', slug: 'old-name' });
  const deleted = netTo(ctx, '/membership/drafts').filter((c) => c.body?.op === 'delete').map((c) => c.body.slug);
  assert.ok(deleted.includes('old-name'), `the record under the old slug was left behind (deleted: ${deleted.join(', ')})`);
});

// SOW-106 Phase C: schema-drift validity surfaced on each draft row.
test('listDrafts: a draft that fails the CURRENT schema carries valid:false + a reason; a clean one valid:true', async () => {
  const ctx = draftCtx({ drafts: [
    rec('fine', { type: 'post', title: 'Fine', slug: 'fine', author: 'alice', status: 'published' }),
    rec('broken', { type: 'post', slug: 'broken', author: 'alice', status: 'published' }), // no title (required)
  ] });
  const { drafts } = await listDrafts(ctx, {});
  const fine = drafts.find((d) => d.slug === 'fine');
  const broken = drafts.find((d) => d.slug === 'broken');
  assert.equal(fine.valid, true);
  assert.equal(fine.invalidReason, null);
  assert.equal(broken.valid, false);
  assert.match(String(broken.invalidReason), /title/i);
});

// sow-274 Part 2 removed the alreadyGone and real-failure branch deletes: discarding is a store delete now.

// sow-194: the extension/npm client-core fold of committed repo drafts into the Drafts listing + the store
// routing of the draft ops. A repo draft is a status:draft item committed to the public repo (store:'repo').
test('listDrafts: folds the caller\'s committed repo drafts (store:repo), deduped against a staged draft of the same slug', async () => {
  const items = [
    { type: 'post', slug: 'committed-wip', path: 'members/alice/posts/committed-wip/index.md', owner: 'alice', title: 'Committed WIP', visibility: 'public', status: 'draft' },
    { type: 'post', slug: 'my-post', path: 'members/alice/posts/my-post/index.md', owner: 'alice', title: 'repo dupe of the staged draft', visibility: 'public', status: 'draft' },
  ];
  const ctx = draftCtx({ drafts: [rec('my-post', { title: 'Staged', status: 'published', visibility: 'public' })], repoDrafts: items });
  const { drafts, contentRef } = await listDrafts(ctx, {});
  const repoRows = drafts.filter((d) => d.store === 'repo');
  assert.deepEqual(repoRows.map((d) => d.slug), ['committed-wip']); // the my-post repo row is dropped (staged wins)
  assert.equal(repoRows[0].title, 'Committed WIP');
  assert.equal(repoRows[0].branch, null);
  assert.ok(drafts.some((d) => d.slug === 'my-post' && d.store === 'kv'), 'the staged my-post stays, not the repo dupe');
  assert.equal(contentRef, 'c0ffee', 'the content commit rides back for image pinning (sow-315)');
});

test('listDrafts: a repo-drafts fetch error is FAIL-SOFT (staged drafts still list; no repo rows)', async () => {
  const ctx = draftCtx({ drafts: [rec('my-post', { title: 'Staged' })] }); // repoDrafts undefined -> the route fails
  const { drafts, contentRef } = await listDrafts(ctx, {});
  assert.deepEqual(drafts.map((d) => d.slug), ['my-post']);
  assert.equal(drafts.every((d) => d.store !== 'repo'), true, 'a repo-drafts error must add no repo rows, not blank the list');
  assert.equal(contentRef, null);
});

test('readDraft: store:repo reads the CANONICAL file via the reader (not a store record); path falls back to contentPath', async () => {
  const canonical = '---\ntitle: Committed\nstatus: draft\nvisibility: public\n---\nThe committed body';
  const ctx = draftCtx({});
  const seen = [];
  ctx.reader = { readFile: async (p) => { seen.push(p); return p === 'members/alice/posts/committed-wip/index.md' ? canonical : null; } };
  const out = await readDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo', path: 'members/alice/posts/committed-wip/index.md' });
  assert.equal(out.store, 'repo');
  assert.equal(out.branch, null);
  assert.equal(out.frontmatter.title, 'Committed');
  assert.equal(out.body, 'The committed body');
  // no path -> contentPath(type, username, slug) resolves the same canonical path
  const out2 = await readDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo' });
  assert.equal(out2.frontmatter.title, 'Committed');
  assert.ok(seen.includes('members/alice/posts/committed-wip/index.md'));
  assert.equal(netTo(ctx, '/membership/drafts').length, 0, 'a repo draft never reads the private store');
});

test('discardDraft: store:repo is refused with a typed "unsupported" error (never a store delete)', async () => {
  const ctx = draftCtx({});
  await assert.rejects(
    () => discardDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo' }),
    (e) => { assert.ok(e instanceof OperationError); assert.equal(e.code, 'unsupported'); return true; },
  );
  assert.deepEqual(ctx.calls.net, [], 'a repo draft must never delete a staged record');
});

test('publishDraft: store:repo routes to the status flip (reads canonical, sends a status change), NOT the staged record', async () => {
  const canonical = '---\ntitle: Committed\nstatus: draft\nvisibility: public\n---\nBody';
  const ctx = draftCtx({ membership: 'paid' });
  const seen = [];
  ctx.reader = { readFile: async (p) => { seen.push(p); return canonical; } };
  await publishDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo', path: 'members/alice/posts/committed-wip/index.md' });
  assert.ok(seen.includes('members/alice/posts/committed-wip/index.md'), 'the flip reads the canonical file via the reader');
  const authored = netTo(ctx, '/membership/author');
  assert.equal(authored.length, 1);
  assert.equal(authored[0].body.itemId, 'status-post-committed-wip', 'the flip rides its own status branch');
  assert.match(authored[0].body.files[0].content, /status: published/);
  assert.equal(netTo(ctx, '/membership/drafts').length, 0, 'a repo draft publish never touches the private store');
});

test('publishDraft: store:repo for a non-paid member is blocked by the flip\'s own gate', async () => {
  const ctx = draftCtx({ membership: 'trialing' });
  ctx.reader = { readFile: async () => '---\ntitle: C\nstatus: draft\nvisibility: public\n---\nB' };
  await assert.rejects(
    () => publishDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo', path: 'members/alice/posts/committed-wip/index.md' }),
    (e) => { assert.equal(e.code, 'membership-required'); return true; },
  );
  assert.equal(netTo(ctx, '/membership/author').length, 0);
});

// SOW-112 v2: a slug change saved under the item's old identity is a PENDING RENAME; the row surfaces it.
test('saveDraft of a renamed item stages under its old identity, and listDrafts carries pendingSlug', async () => {
  const ctx = draftCtx({ drafts: [rec('other-post', { title: 'Other', slug: 'other-post', status: 'published', visibility: 'public' })] });
  const saved = await saveDraft(ctx, { type: 'post', input: { title: 'My Post', slug: 'brand-new-name' }, body: 'Body', path: 'members/alice/posts/my-post/index.md' });
  assert.deepEqual(saved.renamed, { from: 'my-post', to: 'brand-new-name' });
  assert.equal(saved.path, 'members/alice/posts/my-post/index.md');
  const { drafts } = await listDrafts(ctx, {});
  assert.equal(drafts.find((d) => d.slug === 'my-post').pendingSlug, 'brand-new-name');
  assert.equal(drafts.find((d) => d.slug === 'other-post').pendingSlug, null);
});
