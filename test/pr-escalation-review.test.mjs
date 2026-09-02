// Path-traversal escalation regression. A prior review found that raw startsWith matching let a paid
// member craft changed paths beginning with their own folder prefix but escaping it via "../" or
// "./", which classified as own-folder content and merged with a green check. classify-pr.mjs now
// rejects any non-canonical path fail-closed. These tests assert the exploit is BLOCKED.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPaths, decide, isCleanPath, overridesReappearance, OVERRIDES_GIT_FILES } from '../membership/classify-pr.mjs';
import { ROLE } from '../membership/overrides.mjs';
import { TIER } from '../membership/tiers.mjs';

const OWNED = 'octocat';
// A paid Content Creator (sow-185: today's legacy paid = creator). The tier is irrelevant to these
// escalation cases (a non-canonical / protected path fails before the tier gate), but passing it keeps a
// legitimate own-folder or contribution path from tripping the creator gate for the wrong reason.
const paidMember = (paths) =>
  decide({ paths, role: ROLE.member, effective: { status: 'paid' }, ownedFolder: OWNED, tier: TIER.creator });

const EXPLOITS = [
  'members/octocat/../../house/roles.yml', // self-promote to superadmin
  'members/octocat/../../house/grandfathered.yml', // self-grant paid-equivalent
  'members/octocat/../../CODEOWNERS', // rewrite ownership
  'members/octocat/../../.github/workflows/pr-membership-gate.yml', // neuter the gate
  'members/octocat/../dikafei/posts/takeover/index.md', // write a victim folder
  'members/octocat/./posts/x/index.md', // dot-segment
  '/etc/passwd', // absolute
  'members\\octocat\\posts\\x', // backslash
  'members//octocat/posts/x/index.md', // empty segment (double slash)
];

for (const path of EXPLOITS) {
  test(`traversal blocked: ${path}`, () => {
    const c = classifyPaths([path], OWNED);
    assert.equal(c.unclean.length > 0 || c.ownFolderOnly === false, true);
    const d = paidMember([path]);
    assert.equal(d.check, 'fail');
    assert.equal(d.label, 'rejected-escalation');
    assert.equal(d.autoMerge, false);
  });
}

test('a traversal path mixed with legitimate own content still rejects the whole PR', () => {
  const d = paidMember(['members/octocat/posts/ok/index.md', 'members/octocat/../../house/roles.yml']);
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('isCleanPath accepts canonical repo paths and rejects traversal', () => {
  assert.equal(isCleanPath('members/octocat/posts/x/index.md'), true);
  assert.equal(isCleanPath('house/roles.yml'), true);
  assert.equal(isCleanPath('members/octocat/../x'), false);
  assert.equal(isCleanPath('./x'), false);
  assert.equal(isCleanPath('/abs'), false);
  assert.equal(isCleanPath('a\\b'), false);
  assert.equal(isCleanPath(''), false);
  assert.equal(isCleanPath('a//b'), false);
});

test('the sibling-prefix case is correctly cross-folder (a contribution to octocat-evil, never own)', () => {
  // members/octocat-evil is NOT inside members/octocat (the trailing slash guards this). It is a
  // different owner, so it is treated as a contribution (held pending that owner's approval), and it
  // can never be auto-merged as octocat's own content.
  const c = classifyPaths(['members/octocat-evil/posts/x/index.md'], OWNED);
  assert.equal(c.ownFolderOnly, false);
  assert.equal(c.otherMemberPaths.length, 1);
  assert.deepEqual(c.otherOwners, ['octocat-evil']);
  const d = paidMember(['members/octocat-evil/posts/x/index.md']);
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'contribution-pending-owner');
  assert.equal(d.autoMerge, false);
});

// ---------------------------------------------------------------------------------------------------------
// sow-213 Step 3 REAPPEARANCE GUARD. After bans.yml + grandfathered.yml are migrated off the public repo, no PR
// may RE-CREATE them (person-keyed entitlement records must not return to a public, forkable, CDN-cached repo,
// and a reappearing file flips its section git-owned so the next mirror write rebuilds it from the file and can
// strip live grants). The guard KEYS ON CREATION STATUS, not on touching the path: the five git writers still
// open MODIFY-PRs in the window between the two Step-3 commits, and a modify MUST pass or the safer commit shape
// would break production.
// ---------------------------------------------------------------------------------------------------------

// A superadmin decision: rule 5 auto-merges a superadmin on ANY path (SOW-108), so this is the case the guard
// must beat, and it must beat it BEFORE that short-circuit.
const superadminDec = ({ paths, changedFiles }) =>
  decide({ paths, changedFiles, role: ROLE.superadmin, effective: { status: 'paid' }, ownedFolder: null, tier: TIER.creator });
const adminDec = ({ paths, changedFiles }) =>
  decide({ paths, changedFiles, role: ROLE.admin, effective: { status: 'paid' }, ownedFolder: null, tier: TIER.creator });

test('overridesReappearance flags CREATION statuses and passes modify/removed, fail-closed on unknown', () => {
  const gf = 'house/grandfathered.yml';
  assert.deepEqual(overridesReappearance([{ path: gf, status: 'added' }]), [gf], 'added is a reappearance');
  assert.deepEqual(overridesReappearance([{ path: gf, status: 'renamed' }]), [gf], 'renamed-into is a reappearance');
  assert.deepEqual(overridesReappearance([{ path: gf, status: 'copied' }]), [gf], 'copied is a reappearance');
  assert.deepEqual(overridesReappearance([{ path: gf, status: 'modified' }]), [], 'a writer MODIFY passes');
  assert.deepEqual(overridesReappearance([{ path: gf, status: 'removed' }]), [], 'the deletion REMOVE passes');
  assert.deepEqual(overridesReappearance([{ path: gf, status: 'wat' }]), [gf], 'an unknown status fails closed');
  assert.deepEqual(overridesReappearance([{ path: gf }]), [gf], 'a MISSING status fails closed');
  assert.deepEqual(overridesReappearance([{ path: 'members/x/posts/y/index.md', status: 'added' }]), [], 'a non-guarded path is never a reappearance');
  assert.deepEqual(overridesReappearance(null), [], 'a non-array is empty, never a throw');
  assert.deepEqual([...OVERRIDES_GIT_FILES].sort(), ['house/bans.yml', 'house/grandfathered.yml']);
});

for (const file of OVERRIDES_GIT_FILES) {
  test(`a SUPERADMIN PR that RE-CREATES ${file} is rejected BEFORE the SOW-108 auto-merge`, () => {
    const d = superadminDec({ paths: [file], changedFiles: [{ path: file, status: 'added' }] });
    assert.equal(d.check, 'fail');
    assert.equal(d.label, 'rejected-escalation', 'not superadmin-automerge: the guard fires first');
    assert.equal(d.autoMerge, false);
  });

  test(`a SUPERADMIN PR that MODIFIES ${file} still passes (the git writers keep working between the two commits)`, () => {
    const d = superadminDec({ paths: [file], changedFiles: [{ path: file, status: 'modified' }] });
    assert.equal(d.check, 'pass');
    assert.equal(d.label, 'superadmin-automerge');
  });

  test(`an ADMIN PR that RE-CREATES ${file} is rejected; a MODIFY still routes to review`, () => {
    const created = adminDec({ paths: [file], changedFiles: [{ path: file, status: 'added' }] });
    assert.equal(created.check, 'fail');
    assert.equal(created.label, 'rejected-escalation');
    const modified = adminDec({ paths: [file], changedFiles: [{ path: file, status: 'modified' }] });
    assert.equal(modified.check, 'pass');
    assert.equal(modified.label, 'admin-review', 'an admin modify still goes to code-owner review, unchanged');
  });
}

test('the deletion commit itself (REMOVE of both files) is NOT blocked by the guard', () => {
  const d = superadminDec({
    paths: [...OVERRIDES_GIT_FILES],
    changedFiles: OVERRIDES_GIT_FILES.map((path) => ({ path, status: 'removed' })),
  });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'superadmin-automerge');
});

test('the guard is INERT without changedFiles: paths-only keeps the legacy superadmin-automerge behaviour', () => {
  // decide() callers that pass no statuses (the SOW-003 scoping CI) must be unaffected; the gate is the
  // enforcement point and always supplies changedFiles.
  const d = superadminDec({ paths: ['house/bans.yml'], changedFiles: null });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'superadmin-automerge');
});

test('a re-create ADD mixed with a legitimate file still rejects the whole PR', () => {
  const d = superadminDec({
    paths: ['house/site-settings.yml', 'house/bans.yml'],
    changedFiles: [{ path: 'house/site-settings.yml', status: 'modified' }, { path: 'house/bans.yml', status: 'added' }],
  });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});
