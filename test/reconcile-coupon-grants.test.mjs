// SOW-005 reconcile tests: applyPendingCouponGrants, which pre-applies coupon grants not yet folded so the run
// that folds them already sees them (sow-218), and reconcileOverlayCatch, the reconcile fail posture for a KV
// overlay failure (sow-213 R4). No network, no secrets: the grant tests build their own temp root. Split out of
// test/reconcile.test.mjs at the 900-line limit (owner, 2026-09-30); the shared fixtures live in
// test/lib/reconcile-fixtures.mjs.
// Run the reconcile suites together:
//   node --test 'test/reconcile*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyPendingCouponGrants, reconcileOverlayCatch } from '../scripts/reconcile.mjs'; // sow-218: pre-apply; sow-213 R4: overlay fail posture
import { effectiveStatus } from '../membership/overrides.mjs';

// sow-218: pre-applying unfolded coupon grants, so run ONE sees a grant it is about to write down.
//
// The durable fold opens a PR and merges it via the API, which never touches this run's checkout. That is why
// a coupon invitee needed two daily runs: run one folded a grant it could not itself see, and only run two
// resolved them effective-paid. Until then they were not paid to the gate and not eligible for members-index
// enrollment, so the site promised Content Creator through 2027 while every publish was rejected.
// THESE TESTS BUILD THEIR OWN ROOT, and that is the fix for a red main rather than a nicety.
//
// They used to pass `root: tempRoot()`, so applyPendingCouponGrants read the LIVE
// house/grandfathered.yml, and the fixture named a REAL member (github_id 190312419, metacast). On
// 2026-08-13 the reconcile bot folded exactly that member's coupon grant into exactly that file (22d31cf,
// PR #282), which is the whole point of the fold. planCouponGrants then correctly SKIPPED the redemption
// as already granted and returned 0, and the test that asserted 1 went red on main.
//
// Nothing was wrong with the code. The test asked production data to stay still, and the feature under
// test is the thing that moves it. A temp root removes the dependency entirely.
// 2026-09-10: the already-folded set is read from the KV MIRROR now (sow-213 Phase 3b deleted the file), injected
// here as `readGrandfathered`. tempRoot keeps only the coupon registry, which readCouponsFromDisk still reads.
const mirrorWith = (grants = []) => async () => ({ parsed: { grandfathered: grants } });

function tempRoot({ grandfathered = 'grandfathered: []\n', coupons = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-reconcile-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'house', 'grandfathered.yml'), grandfathered, 'utf8');
  if (coupons) fs.writeFileSync(path.join(dir, 'house', 'coupons.yml'), coupons, 'utf8');
  return dir;
}

test('sow-218: an unfolded KV grant is applied to THIS run\'s overrides', async () => {
  const overrides = { grandfathers: new Map(), bans: new Map(), roles: new Map(), membersIndex: new Map() };
  const listRedemptions = async () => ({
    available: true,
    redemptions: [{ code: 'CODEABLEYEAR', githubId: '190312419', login: 'metacast', until: '2027-08-12T00:00:00.000Z' }],
  });
  const root = tempRoot({ coupons: 'coupons:\n  - code: CODEABLEYEAR\n    freeDays: 365\n    active: true\n    tier: creator\n' });
  const n = await applyPendingCouponGrants({ overrides, listRedemptions, now: new Date('2026-08-12T00:00:00Z'), root, readGrandfathered: mirrorWith([]) });
  assert.equal(n, 1);
  const g = overrides.grandfathers.get('190312419');
  assert.equal(g.reason, 'coupon:CODEABLEYEAR');
  assert.equal(g.until, '2027-08-12T00:00:00.000Z');
  // sow-185: the pre-applied grant names its tier from the coupon registry, so THIS run gates on the same
  // tier the durable fold is about to write down. The two callers of planCouponGrants must not disagree.
  assert.equal(g.tier, 'creator');
});

// The behaviour that broke the old test is itself worth pinning: a grant ALREADY folded into
// house/grandfathered.yml must never be pre-applied a second time.
test('sow-218: a grant already folded into the mirror is NOT re-applied', async () => {
  const overrides = { grandfathers: new Map(), bans: new Map(), roles: new Map(), membersIndex: new Map() };
  const listRedemptions = async () => ({
    available: true,
    redemptions: [{ code: 'CODEABLEYEAR', githubId: '190312419', login: 'metacast', until: '2027-08-12T00:00:00.000Z' }],
  });
  const readGrandfathered = mirrorWith([{ github_id: '190312419', login: 'metacast-entertainment', reason: 'coupon:CODEABLEYEAR', until: '2027-08-12T12:56:20.498Z', tier: 'creator', source: 'kv' }]);
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions, now: new Date('2026-08-12T00:00:00Z'), root: tempRoot(), readGrandfathered }), 0);
  assert.equal(overrides.grandfathers.size, 0, 'the fold is the durable record; a second apply would be a duplicate');
});

test('sow-218: an EXPIRED grant is not applied, and an empty KV is a clean no-op', async () => {
  const overrides = { grandfathers: new Map() };
  const expired = async () => ({ available: true, redemptions: [{ code: 'X', githubId: '1', until: '2020-01-01T00:00:00.000Z' }] });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: expired, now: new Date('2026-08-12T00:00:00Z'), root: tempRoot(), readGrandfathered: mirrorWith() }), 0);
  assert.equal(overrides.grandfathers.size, 0);
  const empty = async () => ({ available: true, redemptions: [] });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: empty, root: tempRoot(), readGrandfathered: mirrorWith() }), 0);
});

test('sow-218: a KV failure degrades to the OLD two-run behaviour rather than aborting the run', async () => {
  // Best-effort by design, exactly like the fold itself. A reconcile has content flips and role syncs to do;
  // losing the same-day optimization must never cost the rest of the run.
  const overrides = { grandfathers: new Map() };
  const boom = async () => { throw new Error('KV down'); };
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: boom, root: tempRoot() }), 0);
  const unavailable = async () => ({ available: false, reason: 'CF credentials not set' });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: unavailable, root: tempRoot() }), 0);
  // and an UNREADABLE mirror is the same story: no throw, no grants, run continues.
  const ok = async () => ({ available: true, redemptions: [{ code: 'X', githubId: '1', until: '2027-01-01T00:00:00.000Z' }] });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: ok, root: tempRoot(), readGrandfathered: async () => null }), 0);
  assert.equal(overrides.grandfathers.size, 0);
  // and the DEFAULT reader without Cloudflare credentials reads as unavailable, never as "no grants folded yet".
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: ok, root: tempRoot(), env: {} }), 0);
  assert.equal(overrides.grandfathers.size, 0);
});

test('2026-09-08 incident: a coupon member holding @Member from signup is NOT read as unpaid on the first run after', async () => {
  // The Worker gives a coupon member @Member the moment they link Discord. Their grant is folded into the mirror
  // only AFTER the plan in the same run, so with the pre-apply dead (it read a deleted file) the first daily run
  // read them as derived 'none' and planned add-role locked / remove-role member. Job 102055325536, 12:09 UTC.
  const overrides = { grandfathers: new Map(), bans: new Map(), roles: new Map(), membersIndex: new Map() };
  const listRedemptions = async () => ({ available: true, redemptions: [{ code: 'CODEABLEYEAR', githubId: '30054724', login: 'stefanoginella', until: '2027-09-08T06:43:26.167Z' }] });
  const now = new Date('2026-09-08T12:09:45Z');
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions, now, root: tempRoot(), readGrandfathered: mirrorWith([]) }), 1);
  const eff = effectiveStatus('30054724', 'none', overrides, now);
  assert.equal(eff.status, 'paid', 'the grant is visible to this run, so the plan keeps @Member');
  assert.equal(eff.source, 'grandfather');
});

test('sow-213 R4 reconcileOverlayCatch: tolerates a KV overlay failure while git files are present; fails closed once gone', async () => {
  // The reconcile-specific fail posture, which diverges from the gate's on purpose: reconcile is the mirror's own
  // write source, so it must not abort on a KV read blip while git (the thing it rewrites the mirror from) is
  // still present. Once the files are gone, KV is the only source and there is nothing to rewrite from -> throw.
  const err = new Error('overrides unavailable from KV (stale); refusing to gate [mode=both]');

  // git files PRESENT -> greppable warn, and it MUST NOT rethrow (the daily sync keeps running on git).
  let warned = null;
  reconcileOverlayCatch(err, { root: '/x', filesPresent: () => true, log: { warn: (m) => { warned = m; } } });
  assert.match(warned, /OVERRIDES-OVERLAY-FALLBACK/, 'the fallback line carries the greppable Step-3 gate token');
  assert.match(warned, /stale/, 'and it names the underlying KV reason');

  // git files GONE -> rethrow the ORIGINAL error unchanged (fail closed; KV is the only source now).
  assert.throws(
    () => reconcileOverlayCatch(err, { root: '/x', filesPresent: () => false, log: { warn: () => { throw new Error('warn must not be called when failing closed'); } } }),
    (e) => e === err,
    'post-deletion the overlay failure aborts the run rather than silently using an empty override set',
  );
});
