// SOW-071: the pure moderation-control helpers (client-ui/src/mod-actions-core.mjs). No IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modPathFor, visibleActions } from '../client-ui/src/mod-actions-core.mjs';

test('modPathFor builds the canonical per-type member path', () => {
  assert.equal(modPathFor({ type: 'post', author: 'alice', slug: 'x' }), 'members/alice/posts/x/index.md');
  assert.equal(modPathFor({ type: 'product', author: 'alice', slug: 'x' }), 'members/alice/products/x/index.md');
  assert.equal(modPathFor({ type: 'prompt', author: 'alice', slug: 'x' }), 'members/alice/prompts/x/index.md');
  assert.equal(modPathFor({ type: 'share', author: 'alice', id: '2026-06-28-note' }), 'members/alice/shares/2026-06-28-note.md');
});

test('modPathFor returns null for a missing/unsafe author/slug/id (never a non-member or traversal path)', () => {
  assert.equal(modPathFor({ type: 'post', author: 'alice' }), null); // no slug
  assert.equal(modPathFor({ type: 'share', author: 'alice' }), null); // no id
  assert.equal(modPathFor({ type: 'post', author: '../../house', slug: 'roles' }), null); // traversal author
  assert.equal(modPathFor({ type: 'post', author: 'alice', slug: 'a/b' }), null); // slash in slug
  assert.equal(modPathFor({ type: 'page', author: 'alice', slug: 'x' }), null); // unknown type
  assert.equal(modPathFor({}), null);
});

test('visibleActions: none below moderator, Hide/Unhide at moderator+, +Remove at admin+ (fail closed)', () => {
  assert.deepEqual(visibleActions('member'), []);
  assert.deepEqual(visibleActions('moderator'), ['hide', 'unhide']);
  assert.deepEqual(visibleActions('admin'), ['hide', 'unhide', 'remove']);
  assert.deepEqual(visibleActions('superadmin'), ['hide', 'unhide', 'remove']);
  assert.deepEqual(visibleActions(undefined), []); // unknown role -> none
});
