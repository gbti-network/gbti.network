// sow-316 Phase 2: a paid member below the Curator tier is told publishing needs Curator status, before writing.
//
// Until 2026-09-08 nothing said so until the Worker refused the publish, and the refusal said "upgrade" for a
// tier that is granted by application. A new member reported it in his first hour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { curatorBanner, trialBanner } from '../client-ui/src/workspace-core.mjs';

test('a paid member below Curator gets the banner, pointing at the application', () => {
  const b = curatorBanner('paid', 'member', true);
  assert.ok(b, 'a basic paid member must be told');
  assert.match(b.headline, /Curator/);
  assert.match(b.body, /granted by application/, 'it must not say upgrade: the tier is apply-only (sow-293)');
  assert.doesNotMatch(b.body, /upgrade/i);
  assert.equal(b.ctaHref, 'https://gbti.network/creator-application/');
});

test('a Curator gets NO banner', () => {
  assert.equal(curatorBanner('paid', 'creator', true), null, 'nagging a curator to apply for curator is the bug tier-cta already guards against');
});

test('a trial member gets the TRIAL banner, not this one, and never both', () => {
  // The workspace picks trialBanner || curatorBanner. For a trial member the first wins; this must yield null
  // so the combination can never render two banners.
  assert.equal(curatorBanner('trialing', 'none', true), null);
  assert.ok(trialBanner('trialing', true), 'and the trial banner is the one that shows');
});

test('an unknown or absent tier shows the banner, the safe direction', () => {
  // A stale client or an older Worker reports no tier. Showing a basic member the notice is harmless; hiding
  // it from one who needs it is the defect.
  assert.ok(curatorBanner('paid', 'none', true));
  assert.ok(curatorBanner('paid', undefined, true));
});

test('signed-out, lapsed and free members get nothing here', () => {
  for (const m of ['none', 'expired', 'cancelled', 'banned', 'unknown']) assert.equal(curatorBanner(m, 'none', true), null, m);
});

test('the workspace element actually renders it in the trial banner slot', () => {
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-workspace.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(code, /trialBanner\(ov\.membership, this\._authoring\(\)\) \|\| curatorBanner\(ov\.membership, ov\.paidTier, this\._authoring\(\)\)/,
    'the banner must be wired into the same slot, or a correct function nothing calls');
  assert.match(code, /paidTier: status\?\.paidTier \|\| 'none'/, 'the overview must carry the tier for the banner to read');
});

test('the Worker refusal names Curator and the application, not an upgrade', () => {
  const src = readFileSync(new URL('../workers/signup/membership-content.mjs', import.meta.url), 'utf8');
  assert.match(src, /requires \$\{tierLabel\(TIER\.creator\)\} status, which is granted by application: https:\/\/gbti\.network\/creator-application\//, 'bound to the label, not spelled');
  assert.doesNotMatch(src, /requires the Content Creator plan; upgrade/, 'the old message told an apply-only tier to upgrade');
});
