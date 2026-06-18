// SOW-041: the generic comment-thread operation (listComments) behind the shared <gbti-discussion>. Validates
// targetType + targetSlug and delegates to reader.listComments(targetType, targetSlug, limit). No DOM/network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listComments } from '../client/src/operations.mjs';

const ctxWith = (reader) => ({ identity: () => ({ username: 'a', githubId: '1', login: 'a' }), store: { get: () => null }, reader });

test('listComments delegates to reader.listComments(targetType, targetSlug, limit)', async () => {
  const calls = [];
  const ctx = ctxWith({ listComments: async (t, s, n) => { calls.push([t, s, n]); return [{ author: 'a', body: 'hi' }]; } });
  const r = await listComments(ctx, { targetType: 'post', targetSlug: 'hello' });
  assert.deepEqual(r, { items: [{ author: 'a', body: 'hi' }] });
  assert.deepEqual(calls[0], ['post', 'hello', 100]);
  // share uses the composite slug, same path
  await listComments(ctx, { targetType: 'share', targetSlug: 'alice/20260101-x', limit: 5 });
  assert.deepEqual(calls[1], ['share', 'alice/20260101-x', 5]);
});

test('listComments rejects a bad targetType or a missing targetSlug', async () => {
  const ctx = ctxWith({ listComments: async () => [] });
  await assert.rejects(listComments(ctx, { targetType: 'bogus', targetSlug: 'x' }), (e) => e.code === 'bad-request');
  await assert.rejects(listComments(ctx, { targetType: 'post' }), (e) => e.code === 'bad-request');
  await assert.rejects(listComments(ctx, { targetSlug: 'x' }), (e) => e.code === 'bad-request');
});

test('listComments returns an empty list when the reader has no listComments method (fail-soft)', async () => {
  const r = await listComments(ctxWith({}), { targetType: 'prompt', targetSlug: 'p1' });
  assert.deepEqual(r, { items: [] });
});
