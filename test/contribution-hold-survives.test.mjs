// sow-274 Part 3: THE ONE PLACE THIS WORK COULD FAIL OPEN.
//
// Part 3 removed every GBTI surface for reviewing a change one member makes to another member's folder: the
// inbox, the review screen, the agent tools, the operations and the network reads behind them. Nothing GBTI runs
// can create such a change or approve one any more. What stays is the merge gate's hold, because a pull request
// can still be opened by hand on GitHub, and the gate is the only thing between that pull request and the site.
//
// So this file asserts the hold survived the deletion around it: such a pull request is HELD, never passed,
// never auto-merged, never auto-closed, and its message no longer promises an in-app review nobody can give.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decide } from '../membership/classify-pr.mjs';
import { ROLE } from '../membership/overrides.mjs';
import { TIER } from '../membership/tiers.mjs';
import { shouldAutoClose, shouldAutoMerge } from '../scripts/pr-gate.mjs';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../client/src/mcp-tools.mjs';
import { createRepoClient } from '../client/src/github-repo.mjs';

const PAID = { status: 'paid' };
const OTHER = ['members/someone-else/posts/x/index.md'];

test('a change to another member\'s folder, opened by hand, is HELD at every tier', () => {
  for (const tier of [TIER.member, TIER.creator]) {
    const d = decide({ paths: OTHER, role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier });
    assert.equal(d.check, 'fail', `tier ${tier}: the hold became a pass`);
    assert.equal(d.label, 'contribution-pending-owner', `tier ${tier}: the hold became something else (${d.label})`);
    assert.notEqual(d.autoMerge, true);
    assert.equal(shouldAutoMerge(d, OTHER), false, `tier ${tier}: a held contribution would auto-merge`);
  }
});

test('a held contribution is never closed automatically, so a superadmin can still decide it', () => {
  assert.equal(shouldAutoClose('contribution-pending-owner', true), false);
  assert.equal(shouldAutoClose('contribution-pending-owner', false), false);
});

test('the hold says a superadmin decides, and no longer promises an in-app review', () => {
  const d = decide({ paths: OTHER, role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.creator });
  assert.match(d.reasons.join(' '), /superadmin decides/);
  assert.doesNotMatch(d.reasons.join(' '), /approving review from the folder owner/);
});

test('even an owner approval on GitHub does not merge it on its own', () => {
  // The gate still reads an owner's approving review and passes the check, but it never turns on auto-merge for
  // a contribution, so a person with merge rights still has to act. That is the superadmin, by hand.
  const d = decide({ paths: OTHER, role: ROLE.member, effective: PAID, ownedFolder: 'octocat', ownerApproved: true, ownerPaid: true, tier: TIER.creator, ownerTier: TIER.creator });
  assert.equal(d.label, 'contribution-accepted');
  assert.equal(d.autoMerge, false);
  assert.equal(shouldAutoMerge(d, OTHER), false);
});

// ---- and the surfaces stay gone ----
//
// A review screen with nothing behind it renders an empty list forever, which is how the website's Inbox went
// unnoticed. So the removal itself is guarded: each surface is checked by what it exposes, not by file name.

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('no GBTI surface offers contribution review any more', () => {
  const tools = TOOLS.map((t) => t.name);
  for (const name of ['list_contributions', 'get_contribution', 'review_contribution']) {
    assert.equal(tools.includes(name), false, `the agent server offers ${name} again`);
  }

  const repo = createRepoClient({ token: 't', upstream: 'gbti-network/gbti.network', fetch: async () => ({}) });
  for (const method of ['submitReview', 'closePull', 'getPull', 'getPullDiffFiles', 'listPullFiles']) {
    assert.equal(method in repo, false, `the repository client can ${method} again`);
  }

  for (const route of ["'/api/contributions'", "'/api/contribution'", "'/api/contribution-review'"]) {
    assert.equal(read('client/src/api.mjs').includes(route), false, `the command line host serves ${route} again`);
    assert.equal(read('extension/src/ext-dispatch.mjs').includes(route), false, `the extension serves ${route} again`);
  }
  assert.doesNotMatch(read('client-ui/src/client.mjs'), /\b(listContributions|getContribution|reviewContribution)\s*:/);

  const worker = read('workers/signup/index.mjs');
  for (const route of ["'/membership/pr'", "'/membership/pr-files'"]) {
    assert.equal(worker.includes(`pathname === ${route}`), false, `the network serves ${route} again`);
  }
});
