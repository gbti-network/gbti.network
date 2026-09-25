// SOW-071: the pure moderation-control helpers (client-ui/src/mod-actions-core.mjs). No IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modPathFor, menuActions, flagKeyFor } from '../client-ui/src/mod-actions-core.mjs';

test('modPathFor builds the canonical per-type member path', () => {
  assert.equal(modPathFor({ type: 'post', author: 'alice', slug: 'x' }), 'members/alice/posts/x/index.md');
  assert.equal(modPathFor({ type: 'project', author: 'alice', slug: 'x' }), 'members/alice/projects/x/index.md');
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

// sow-409 (owner, 2026-09-25): "these admin tools needs to be moved into a superadmin only elipsis dropdown." This
// replaced the SOW-071 tiers (moderator Hide/Unhide, admin +Remove, superadmin all seven).
test('menuActions: nothing for anyone but a superadmin (fail closed)', () => {
  for (const role of ['member', 'moderator', 'admin', undefined, null, '', 'SUPERADMIN']) {
    assert.deepEqual(menuActions({ role, type: 'post', flags: { stale: false, unindexed: false } }), [], String(role));
  }
});

test('menuActions: an unmarked article offers Hide, Mark stale, Unindex, and Remove last', () => {
  assert.deepEqual(menuActions({ role: 'superadmin', type: 'post', flags: { stale: false, unindexed: false } }), ['hide', 'stale', 'unindex', 'remove']);
});

test('menuActions: a marked item offers the other half of each pair', () => {
  assert.deepEqual(menuActions({ role: 'superadmin', type: 'prompt', flags: { stale: true, unindexed: true } }), ['hide', 'unstale', 'reindex', 'remove']);
  assert.deepEqual(menuActions({ role: 'superadmin', type: 'project', flags: { stale: true, unindexed: false } }), ['hide', 'unstale', 'unindex', 'remove']);
});

test('menuActions: marks that could not be read offer both halves', () => {
  assert.deepEqual(menuActions({ role: 'superadmin', type: 'post', flags: null }), ['hide', 'stale', 'unstale', 'unindex', 'reindex', 'remove']);
});

test('menuActions: a share has no marks, so Hide and Remove only', () => {
  assert.deepEqual(menuActions({ role: 'superadmin', type: 'share', flags: null }), ['hide', 'remove']);
  assert.deepEqual(menuActions({ role: 'superadmin', type: 'share', flags: { stale: true, unindexed: true } }), ['hide', 'remove']);
});

test('menuActions: never Unhide (the reader and the Shares feed only show live items), Remove always last', () => {
  for (const type of ['post', 'project', 'product', 'prompt', 'share']) {
    for (const flags of [null, { stale: true, unindexed: false }, { stale: false, unindexed: true }]) {
      const a = menuActions({ role: 'superadmin', type, flags });
      assert.equal(a.includes('unhide'), false, `${type}`);
      assert.equal(a[a.length - 1], 'remove', `${type}`);
    }
  }
});

test('flagKeyFor: the published key for an article, project or prompt, none for a share', () => {
  assert.equal(flagKeyFor('post', 'hello'), 'post:hello');
  assert.equal(flagKeyFor('product', 'thing'), 'project:thing');
  assert.equal(flagKeyFor('prompt', 'p'), 'prompt:p');
  assert.equal(flagKeyFor('share', 'x'), null);
  assert.equal(flagKeyFor('post', 'a/b'), null);
});
