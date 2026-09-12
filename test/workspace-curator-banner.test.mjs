// sow-323: a paid supporter is told, BEFORE they write, that their work publishes to members first and a
// superadmin reviews it for the public site.
//
// The banner's whole purpose has now been wrong twice in the same place, and the history is the lesson. Until
// 2026-09-08 nothing told a paid member anything and the Worker refused the publish with "upgrade", for a tier
// that was granted by application rather than bought (sow-316 fixed the wording). On 2026-09-12 the owner
// collapsed the two paid plans, publishing became part of the membership, and the corrected wording went wrong
// in the other direction: it told a paying supporter they needed a plan that no longer exists. The test moved
// with it both times, which is exactly why a test pinning copy has to name what the copy is FOR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { curatorBanner, trialBanner } from '../client-ui/src/workspace-core.mjs';

test('a paid supporter is told their work goes to members first and is reviewed', () => {
  const b = curatorBanner('paid', 'member', true);
  assert.ok(b, 'a paid supporter must be told before they write, not refused afterwards');
  assert.match(b.headline, /members first/i);
  assert.match(b.body, /superadmin reviews it/, 'it must say who decides and what they decide');
  // The three things it must NOT do any more. Each of these was true copy once.
  assert.doesNotMatch(b.body, /upgrade/i, 'publishing is included: there is nothing to upgrade to');
  assert.doesNotMatch(b.body, /apply/i, 'there is no application: the plan it applied for is retired');
  assert.doesNotMatch(JSON.stringify(b), /Curator/, 'the internal trust level must not appear in member copy');
  assert.equal(b.ctaHref, 'https://gbti.network/submit-content/', 'it points at the page that explains publishing');
});

test('a TRUSTED author gets NO banner, because for them nothing waits', () => {
  assert.equal(curatorBanner('paid', 'creator', true), null,
    'a superadmin silently granted this tier publishes straight to public; telling them their work waits would be false');
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
