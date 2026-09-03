// SOW-092: the pure helpers behind the share-submit instant redirect — the author parse from the publish
// path and the reader-ready optimistic item (local plaintext body, never an encryptedBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorFromPath, optimisticShareItem, shareComposerView, canSharePublicly, SHARE_LOCKED_STATES } from '../client-ui/src/share-post-core.mjs';

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

// sow-204: the composer's five states. sow-218 built the Content Creator gate, the owner narrowed it again on
// 2026-08-28, and NOTHING in the suite asserted any of it: a grep for the element's own branch names across
// test/ returned zero files, and the control (the trial branch, which has existed far longer) returned zero
// too, so it was the coverage that was missing rather than the search that was wrong.
test('shareComposerView: every membership and tier lands on the state the member is actually in', () => {
  const v = (o) => shareComposerView(o);
  // Order matters and is asserted, not assumed: no-client outranks everything, because a signed-in creator
  // reading the site with no extension must still be told where Shares are posted from.
  assert.equal(v({ hasClient: false, membership: 'paid', tier: 'creator' }), 'no-client');
  assert.equal(v(), 'no-client', 'no arguments at all is the inert public-site case, not a crash');
  assert.equal(v({ hasClient: true }), 'loading', 'an unresolved membership is loading, never a denial');

  for (const m of ['expired', 'cancelled', 'none', 'banned']) {
    assert.equal(v({ hasClient: true, membership: m, tier: 'creator' }), 'locked',
      `${m} is locked even holding creator tier: a lapse outranks the tier it used to pay for`);
  }
  assert.equal(v({ hasClient: true, membership: 'trialing', tier: 'creator' }), 'trial');

  // sow-293 REVERSED the owner's 2026-08-28 ruling on 2026-09-03. A paid Network Member used to get an
  // upgrade splash INSTEAD of the composer; sharing is now open to every paid member and the tier gates the
  // VISIBILITY instead. The upgrade nudge did not vanish, it moved to the public option (canSharePublicly).
  assert.equal(v({ hasClient: true, membership: 'paid', tier: 'member' }), 'composer',
    'sharing opened to every paid member on 2026-09-03; the tier now gates visibility, not the composer');
  assert.equal(v({ hasClient: true, membership: 'paid', tier: 'creator' }), 'composer');
  for (const t of [null, undefined, '']) {
    assert.equal(v({ hasClient: true, membership: 'paid', tier: t }), 'composer');
  }
  assert.equal(v({ hasClient: true, membership: 'unknown', tier: null }), 'composer');
});

test('sow-293 canSharePublicly: the tier gates PUBLIC sharing, and nothing else', () => {
  const p = (o) => canSharePublicly(o);
  assert.equal(p({ membership: 'paid', tier: 'creator' }), true);
  assert.equal(p({ membership: 'paid', tier: 'member' }), false, 'a Network Member shares to members only');

  // Anyone who cannot reach the composer at all certainly cannot post publicly. Asserted rather than assumed,
  // because these two functions are read side by side and a reader will expect them to agree.
  for (const m of ['expired', 'cancelled', 'none', 'banned', 'trialing']) {
    assert.equal(p({ membership: m, tier: 'creator' }), false, `${m} must not post publicly even holding creator`);
  }

  // FAIL OPEN ON AN ABSENT TIER, carried over verbatim from the gate this replaces. An absent tier means the
  // oracle did not answer, not that the answer was no, and stripping public posting from a real Content
  // Creator because a status call failed is the worse error. The Worker reads the file's own visibility
  // before committing, so the affordance is not the boundary.
  for (const t of [null, undefined, '']) {
    assert.equal(p({ membership: 'paid', tier: t }), true, 'an unresolved tier fails OPEN; the Worker is the authority');
  }
});

test('SHARE_LOCKED_STATES is the single definition, and the element no longer keeps its own copy', () => {
  // The element held an identical `const LOCKED` until sow-204 moved the branch decision out. Two copies of a
  // membership-state list is how an affordance and the gate it mirrors drift apart without either looking wrong.
  assert.deepEqual([...SHARE_LOCKED_STATES].sort(), ['banned', 'cancelled', 'expired', 'none']);
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-share-composer.mjs', import.meta.url), 'utf8');
  assert.ok(/shareComposerView\(/.test(src), 'the element must ASK the helper, or these assertions test nothing it uses');
  assert.ok(!/^const LOCKED = /m.test(src), 'the element re-declared its own locked-state list');
});
