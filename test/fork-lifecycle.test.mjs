// SOW-106 Phase 2: forkContentMatchesLive drives the fork-branch cleanup. It must ONLY report "merged" when the
// staged content is byte-identical to the live network version, so a pending edit is never mistaken for merged
// (which would hide or delete member work). These tests pin that conservatism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkContentMatchesLive, syncForkForPublish } from '../client/src/operations.mjs';
import { serializeContentFile, parseContentFile, buildContentFile } from '../client/src/content-ops.mjs';

const forkRepo = (existing, calls, { openPull = null, syncResult = { merge_type: 'fast-forward' } } = {}) => ({
  upstream: 'gbti-network/gbti.network',
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async mergeUpstream() { calls.merge = (calls.merge || 0) + 1; return syncResult; },
  async getForkFileContent() { return existing; },
  async findOpenPull() { return openPull; },
  async deleteBranch(_r, b) { (calls.del ||= []).push(b); },
});

const fm = { title: 'T', slug: 's', status: 'published', type: 'prompt', author: 'a' };
const readerFor = (live) => ({ read: async () => live });
const path = 'members/a/prompts/s/index.md';

test('forkContentMatchesLive: identical fork + live content -> merged (true)', async () => {
  const raw = serializeContentFile(fm, 'body text');
  const ctx = { reader: readerFor(parseContentFile(raw)) }; // the live version IS the merged staged version
  assert.equal(await forkContentMatchesLive(ctx, path, raw), true);
});

test('forkContentMatchesLive: a pending body edit -> NOT merged (false, keep the draft)', async () => {
  const raw = serializeContentFile(fm, 'NEW pending body');
  const ctx = { reader: readerFor({ frontmatter: fm, body: 'old live body' }) };
  assert.equal(await forkContentMatchesLive(ctx, path, raw), false);
});

test('forkContentMatchesLive: a pending frontmatter edit -> NOT merged (false)', async () => {
  const raw = serializeContentFile({ ...fm, tags: ['new'] }, 'body text');
  const ctx = { reader: readerFor({ frontmatter: fm, body: 'body text' }) };
  assert.equal(await forkContentMatchesLive(ctx, path, raw), false);
});

test('forkContentMatchesLive: a member-only item (encryptedBody) is never auto-cleaned (false)', async () => {
  const raw = serializeContentFile({ ...fm, encryptedBody: 'members/a/prompts/s/index.enc' }, '');
  const ctx = { reader: readerFor({ frontmatter: fm, body: '' }) };
  assert.equal(await forkContentMatchesLive(ctx, path, raw), false);
});

test('forkContentMatchesLive: no live content (never merged) -> false', async () => {
  const raw = serializeContentFile(fm, 'body');
  assert.equal(await forkContentMatchesLive({ reader: readerFor(null) }, path, raw), false);
});

// SOW-106 Phase 3: sync-then-publish resets ONLY a fully-merged branch, so a re-publish is a clean diff and no
// pending member work is ever destroyed.
test('syncForkForPublish: syncs the fork and resets a FULLY-MERGED branch (clean re-publish)', async () => {
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'm1', shortDescription: 'x' }, body: 'B' });
  const calls = {};
  const ctx = { reader: readerFor(parseContentFile(built.markdown)) }; // live == the merged staged content
  await syncForkForPublish(ctx, forkRepo(built.markdown, calls), built);
  assert.equal(calls.merge, 1, 'the fork main is synced to upstream');
  assert.deepEqual(calls.del, ['gbti/prompt-m1'], 'a fully-merged branch is reset (deleted; the commit recreates it)');
});

test('syncForkForPublish: a branch with a PENDING edit is NEVER reset (no member-work loss)', async () => {
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'm2', shortDescription: 'x' }, body: 'NEW pending body' });
  const calls = {};
  const ctx = { reader: readerFor({ frontmatter: built.frontmatter, body: 'OLD live body' }) }; // live differs -> pending
  await syncForkForPublish(ctx, forkRepo(built.markdown, calls), built);
  assert.equal(calls.merge, 1, 'the fork is still synced');
  assert.deepEqual(calls.del || [], [], 'a pending draft is left untouched');
});

test('syncForkForPublish: does NOT reset a branch with an OPEN PR, even if content matches live (keep the review thread)', async () => {
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'm3', shortDescription: 'x' }, body: 'B' });
  const calls = {};
  const ctx = { reader: readerFor(parseContentFile(built.markdown)) }; // content matches live (would-be merged)
  await syncForkForPublish(ctx, forkRepo(built.markdown, calls, { openPull: { number: 9 } }), built);
  assert.deepEqual(calls.del || [], [], 'an in-review PR branch is never reset');
});

test('syncForkForPublish: does NOT reset when the fork sync did not confirm (dirty fork -> avoid stale-base recreation)', async () => {
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'm4', shortDescription: 'x' }, body: 'B' });
  const calls = {};
  const ctx = { reader: readerFor(parseContentFile(built.markdown)) };
  await syncForkForPublish(ctx, forkRepo(built.markdown, calls, { syncResult: null }), built); // 409 dirty -> null
  assert.equal(calls.merge, 1);
  assert.deepEqual(calls.del || [], [], 'no reset when the sync did not confirm');
});
