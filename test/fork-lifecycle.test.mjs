// SOW-106 Phase 2: forkContentMatchesLive drives the fork-branch cleanup. It must ONLY report "merged" when the
// staged content is byte-identical to the live network version, so a pending edit is never mistaken for merged
// (which would hide or delete member work). These tests pin that conservatism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkContentMatchesLive } from '../client/src/operations.mjs';
import { serializeContentFile, parseContentFile } from '../client/src/content-ops.mjs';

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
