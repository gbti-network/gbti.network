// sow-323 Phase 3: ELEVATION TO TRUSTED AUTHOR IS A SUPERADMIN ACT.
//
// The tier lets its holder publish straight to the public site with no editorial review, so granting it hands
// out the very authority the review queue exists to hold. The grandfather action it rides on has an ADMIN
// floor, which is right for the rest of what that action does (a comped year is not a publishing permission),
// so the tier is checked separately rather than by raising the whole action.
//
// Read from the source rather than driven through the route: the route needs a live mirror, an installation
// token and a GitHub double to reach the check at all, and a test that builds all of that would be asserting
// its own scaffolding. What has to be true is that the check exists, names the creator tier, and sits at
// superadmin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIER } from '../membership/tiers.mjs';
import { PAID_GRANT_TIERS } from '../membership/tier-gate.mjs';

const SRC = readFileSync(new URL('../workers/signup/membership-admin-author.mjs', import.meta.url), 'utf8');

test('the creator tier is still a grantable tier, so the check has something to guard', () => {
  // A positive control. If the tier stopped being grantable the guard below would pass vacuously, and this
  // test would report a rule it is no longer enforcing.
  assert.ok(PAID_GRANT_TIERS.includes(TIER.creator),
    'the guard under test is about granting this tier; if it cannot be granted, the guard proves nothing');
});

test('granting the trusted-author tier requires superadmin', () => {
  const guard = /if \(tier === TIER\.creator && \(ROLE_RANK\[staff\.role\] \?\? 0\) < ROLE_RANK\.superadmin\)/.exec(SRC);
  assert.ok(guard, 'the superadmin check on the trusted-author grant is missing');
  const after = SRC.slice(guard.index, guard.index + 320);
  assert.match(after, /403/, 'it must refuse, not warn');
  assert.match(after, /only a superadmin can make a member a trusted author/,
    'the refusal must say who may do this, or an admin reads it as a bug');
});

test('the check runs BEFORE anything is written', () => {
  // A refusal after the branch, the file write or the pull request would leave a half-done grant behind. The
  // ordering is what makes "a bad value costs nothing" true.
  const guard = SRC.indexOf('tier === TIER.creator');
  const branch = SRC.indexOf('adminHostedBranchFor(githubId, branchSlug)');
  const kvWrite = SRC.indexOf('writeOverrideToKv');
  assert.ok(guard > 0, 'the guard is missing');
  assert.ok(branch < 0 || guard < branch, 'the grant must be refused before a branch is created');
  assert.ok(kvWrite < 0 || guard < kvWrite, 'the grant must be refused before the override is written');
});

test('every other grant keeps its current rank', () => {
  // The guard is scoped to the tier, not to the action. Raising the whole grandfather action to superadmin
  // would quietly take comped memberships away from admins, which nobody asked for.
  assert.match(SRC, /grandfather: \{ path: 'house\/grandfathered\.yml', rank: ROLE_RANK\.admin/,
    'the grandfather action itself must stay at the admin floor');
  assert.match(SRC, /ban: \{ path: 'house\/bans\.yml', rank: ROLE_RANK\.admin/, 'bans are unchanged');
});
