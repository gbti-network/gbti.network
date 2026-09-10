// 2026-09-10: a targeted reconcile (repository_dispatch after a payment or a hosted enrol) gathers ONE member.
// Any enactment that derives a WHOLE-ROSTER artifact from `members` must therefore not run in that mode: on
// 2026-09-09 the one-member roster emptied the Shop Talk guest list (22 cancellations) and, the same night,
// was published as the digest entitlement list (one github_id entitled until the next full run). These pin
// the two guards. A new roster-wide enactment in reconcile.mjs should add its own line here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { digestEntitlementTargetedSkip, shoptalkTargetedSkip } from '../scripts/reconcile.mjs';

test('a full run (no target) runs every roster-wide enactment', () => {
  for (const guard of [digestEntitlementTargetedSkip, shoptalkTargetedSkip]) {
    assert.equal(guard(null), null);
    assert.equal(guard(undefined), null);
    assert.equal(guard(''), null);
  }
});

test('a targeted run skips the digest entitlement publish and names the member it ran for', () => {
  const line = digestEntitlementTargetedSkip('410930');
  assert.match(line, /SKIPPED in targeted mode/);
  assert.match(line, /410930/);
  assert.match(line, /one-member roster would replace the whole list/, 'the log line says what would have broken');
});

test('a targeted run skips the Shop Talk sweep (the guard that would have prevented the 2026-09-09 mail)', () => {
  assert.match(shoptalkTargetedSkip('410930'), /one-member roster must never reach the sweep/);
});
