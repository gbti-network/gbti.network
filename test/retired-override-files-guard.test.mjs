// sow-213 Phase 3b: the gate must refuse to merge a PR that recreates a retired override file.
//
// THIS IS A DATA-LOSS GUARD AND THE NUMBER IS MEASURED, NOT FEARED. Phase 3b deleted house/bans.yml and
// house/grandfathered.yml, but every admin write op (ban / unban / grandfather / ungrandfather, in BOTH the
// Worker and the client host) still composes a PR that RECREATES the file with a single entry. If one merged:
// gitOwnedSections() would see the file, flip that section back to git-owned, and the next mirror write would
// run mergeOverridesSection(recreatedFile, kvBlob), which preserves only rows marked `source: 'kv'`. The live
// grants were mirrored FROM git and carry no such mark. Merging a 1-entry file against the 22 live grants
// returns 1: twenty-one members silently lose their entitlement.
//
// validate-content.mjs also errors on these paths, but that is NOT a required status check on main (sow-298
// Phase 3 measured the branch rules as exactly deletion + non_fast_forward), so it blocks nothing. The gate is
// where a merge is actually decided, which is why the guard lives there and why this test does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, classifyPaths } from '../membership/classify-pr.mjs';
import { ROLE } from '../membership/overrides-core.mjs';
import { TIER } from '../membership/tiers.mjs';

const SUPERADMIN = { role: ROLE.superadmin, effective: 'paid', ownedFolder: 'gbtilabs', tier: TIER.creator };
const ADMIN = { role: ROLE.admin, effective: 'paid', ownedFolder: 'someadmin', tier: TIER.creator };

test('a PR recreating a retired override file is REFUSED, for every role including superadmin', () => {
  // Superadmin specifically, because SOW-108 auto-merges a superadmin PR on ANY path, so that is exactly the
  // actor whose routine admin action would otherwise spring this. A guard that exempted them would be useless.
  for (const actor of [SUPERADMIN, ADMIN]) {
    for (const p of ['house/bans.yml', 'house/grandfathered.yml']) {
      const d = decide({ ...actor, paths: [p] });
      assert.equal(d.check, 'fail', `${p} must not merge for role ${actor.role}`);
      assert.equal(d.autoMerge, false, `${p} must never auto-merge for role ${actor.role}`);
      assert.match(d.reasons.join(' '), /retired by sow-213/, 'the reason must say why, not just refuse');
    }
  }
});

test('the refusal survives being MIXED with legitimate paths, so it cannot be smuggled in', () => {
  // A PR that also touches something ordinary must still be refused: partial acceptance is not a thing, and
  // an attacker or a careless op would otherwise just add a second file.
  const d = decide({ ...SUPERADMIN, paths: ['house/taxonomy.yml', 'house/grandfathered.yml'] });
  assert.equal(d.check, 'fail');
  assert.match(d.reasons.join(' '), /grandfathered\.yml/);
});

test('CONTROL: ordinary house paths are unaffected, so the guard is not just refusing everything', () => {
  // Without this the test above would pass on a decide() that failed every PR.
  for (const p of ['house/taxonomy.yml', 'house/quotes.yml', 'house/coupons.yml']) {
    const d = decide({ ...SUPERADMIN, paths: [p] });
    assert.equal(d.check, 'pass', `${p} must still be mergeable`);
  }
  const own = decide({ ...SUPERADMIN, paths: ['members/gbtilabs/posts/x/index.md'] });
  assert.equal(own.check, 'pass', 'ordinary member content must still be mergeable');
});

test('a path that merely LOOKS like a retired file is not swept up', () => {
  // Precision matters: house/bans.yml.bak or a member file with the same basename is not the retired file.
  for (const p of ['house/bans.yml.bak', 'members/alice/bans.yml', 'house/old-bans.yml']) {
    const d = decide({ ...SUPERADMIN, paths: [p] });
    assert.notEqual(
      d.reasons?.join(' ')?.includes('retired by sow-213'),
      true,
      `${p} is not a retired override file and must not be refused as one`,
    );
  }
});

test('classifyPaths exposes `clean`, which the guard reads', () => {
  // Pins the plumbing the guard depends on. Without `clean` on the classification the guard silently sees an
  // empty list and refuses nothing, which is the fail-OPEN direction and would be invisible.
  const c = classifyPaths(['house/grandfathered.yml', '../escape'], 'gbtilabs');
  assert.ok(Array.isArray(c.clean), 'classifyPaths must expose clean');
  assert.ok(c.clean.includes('house/grandfathered.yml'));
  assert.ok(!c.clean.includes('../escape'), 'unclean paths must not appear in clean');
});
