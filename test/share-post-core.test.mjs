// SOW-092: the pure helpers behind the share-submit instant redirect — the author parse from the publish
// path and the reader-ready optimistic item (local plaintext body, never an encryptedBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorFromPath, optimisticShareItem } from '../client-ui/src/share-post-core.mjs';

test('authorFromPath parses the owning member from a publish result path', () => {
  assert.equal(authorFromPath('members/atwellpub/shares/20260709120000-hello.md'), 'atwellpub');
  assert.equal(authorFromPath('house/shares/x.md'), null);
  assert.equal(authorFromPath(''), null);
  assert.equal(authorFromPath(null), null);
});

test('optimisticShareItem builds a reader-ready item; members visibility carries body, never encryptedBody', () => {
  const res = { id: '20260709120000-hello', path: 'members/atwellpub/shares/20260709120000-hello.md', visibility: 'members' };
  const input = { title: 'Hello', shortDescription: 'A note', url: 'https://youtu.be/N_GfH09iP9c', image: 'https://i.ytimg.com/x.jpg', visibility: 'members' };
  const it = optimisticShareItem({ res, input, body: 'my **note**', now: '2026-07-09T12:00:00.000Z' });
  assert.equal(it.type, 'share');
  assert.equal(it.author, 'atwellpub');
  assert.equal(it.id, res.id);
  assert.equal(it.title, 'Hello');
  assert.equal(it.shortDescription, 'A note');
  assert.equal(it.url, input.url);
  assert.equal(it.image, input.image);
  assert.equal(it.visibility, 'members');
  assert.equal(it.body, 'my **note**');
  assert.equal(it.createdAt, '2026-07-09T12:00:00.000Z');
  assert.equal('encryptedBody' in it, false, 'the optimistic item never carries an encryptedBody');
  // No id or an unparseable path -> no redirect target.
  assert.equal(optimisticShareItem({ res: { id: null, path: res.path } }), null);
  assert.equal(optimisticShareItem({ res: { id: 'x', path: 'weird/path.md' } }), null);
});
