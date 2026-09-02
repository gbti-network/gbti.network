// sow-291 Phase 1: a campaign has two names, and only one of them is a secret.
//
// THE DEFECT THIS IS THE FIRST STEP OF. `house/coupons.yml` is a tracked file in a PUBLIC repository and it
// holds the redeemable codes themselves. A coupon code is a bearer credential: holding the string is the
// entire authorization, there is no recipient binding, no cap and no expiry. Anyone reading the repository
// can redeem a free year, repeatedly, and nothing reports it.
//
// The registry moves to KV. Two consumers cannot follow it there: this test suite (no network, no secrets,
// by project rule) and the Astro build (no KV binding on the runner). Both need to know which campaigns
// exist, what each confers and which page describes it. Neither needs the code. So a code-free PROJECTION
// lands first, and it lands alone, so everything downstream is already reading the stable thing before the
// source moves underneath it.
//
// WHY THE ID/CODE SPLIT IS IN PHASE 1 AND NOT PHASE 4. A guard asserting "the manifest carries no secret"
// would be VACUOUS while a campaign's code and its identity are the same string: there would be nothing the
// projection could leak that it is not also supposed to carry. The split is what makes the guard able to
// fail, so it comes first. `test/campaign-manifest-drift` below is the one that would have to go red before
// a code could reach the public manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { couponsFromParsed, validateCoupons } from '../membership/coupons.mjs';
import { campaignManifest, landerFor } from '../membership/invites.mjs';
import { renderManifest } from '../scripts/build-campaign-manifest.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// A campaign whose code has ALREADY been rotated away from its id. This is the shape that makes every
// assertion below able to fail; with id === code they would all pass over a projection that leaked.
const ROTATED = {
  coupons: [
    { id: 'CODEABLEYEAR', code: 'ZQ7X4M2KDLPV', freeDays: 365, active: true, tier: 'member' },
    { id: 'LINKEDINCONNECT', code: 'B8HN3TWRJC59', freeDays: 365, active: true, tier: 'member' },
  ],
};

test('id defaults to the code, so every record written before the split keeps working', () => {
  // The backward-compatibility property the whole migration rests on. Every committed entry, every test
  // fixture and every mirror blob predates `id`. If the default were anything else, introducing the field
  // would have required rewriting all of them at once, which is how a migration turns into an outage.
  const parsed = { coupons: [{ code: 'PLAINONE', freeDays: 30, active: true, tier: 'member' }] };
  const c = couponsFromParsed(parsed).get('PLAINONE');
  assert.equal(c.id, 'PLAINONE');
  assert.equal(c.code, 'PLAINONE');
});

test('an explicit id is kept, and the two names are independent', () => {
  const c = couponsFromParsed(ROTATED).get('ZQ7X4M2KDLPV');
  assert.equal(c.id, 'CODEABLEYEAR', 'the campaign identity must survive a code rotation');
  assert.equal(c.code, 'ZQ7X4M2KDLPV');
  // Lookup is still BY CODE, because the code is what a person redeems. The id is what the system refers to
  // the campaign as. Confusing the two is how a rotation would strand every existing grant reason.
  assert.equal(couponsFromParsed(ROTATED).has('CODEABLEYEAR'), false, 'an id must not be redeemable');
});

test('a malformed explicit id REJECTS the entry rather than falling back to the code', () => {
  // Fail closed. A silent fallback would mint a second campaign identity that resolves no lander and matches
  // no existing `reason: coupon:<ID>` in house/grandfathered.yml, and it would do it quietly: the coupon
  // would still redeem, and only the provenance and the lander would be wrong.
  const bad = { coupons: [{ id: 'not a valid id', code: 'GOODCODE1', freeDays: 30, active: true, tier: 'member' }] };
  assert.equal(couponsFromParsed(bad).size, 0);
  const empty = { coupons: [{ id: '', code: 'GOODCODE1', freeDays: 30, active: true, tier: 'member' }] };
  assert.equal(couponsFromParsed(empty).get('GOODCODE1')?.id, 'GOODCODE1', 'an ABSENT id still defaults');
});

test('validateCoupons rejects a malformed or duplicated campaign id', () => {
  const dupe = {
    coupons: [
      { id: 'SAMEID', code: 'CODEONE11', freeDays: 30, active: true, tier: 'member' },
      { id: 'SAMEID', code: 'CODETWO22', freeDays: 30, active: true, tier: 'member' },
    ],
  };
  const errs = validateCoupons(dupe);
  assert.ok(errs.some((e) => /duplicate campaign id SAMEID/.test(e)),
    `a duplicate id makes \`reason: coupon:SAMEID\` ambiguous forever; got ${JSON.stringify(errs)}`);
  const malformed = validateCoupons({ coupons: [{ id: 'bad id!', code: 'CODEONE11', freeDays: 30, active: true, tier: 'member' }] });
  assert.ok(malformed.some((e) => /id must be 3-32 chars/.test(e)));
  // And a plain, id-less registry still validates clean, or this check would fail the whole existing file.
  assert.deepEqual(validateCoupons({ coupons: [{ code: 'CODEONE11', freeDays: 30, active: true, tier: 'member' }] }), []);
});

test('THE MANIFEST CARRIES NO CODE, asserted against a registry whose codes differ from its ids', () => {
  // The assertion the projection exists for. It is run against ROTATED on purpose: with id === code it could
  // not distinguish a manifest that dropped the code from one that published it, and would pass either way.
  const { campaigns } = campaignManifest(ROTATED);
  assert.equal(campaigns.length, 2);
  const text = JSON.stringify(campaigns);
  for (const secret of ['ZQ7X4M2KDLPV', 'B8HN3TWRJC59']) {
    assert.ok(!text.includes(secret), `the manifest leaked the redeemable code ${secret}`);
  }
  for (const c of campaigns) {
    assert.equal('code' in c, false, 'code must be ABSENT, not blank: a blank reads as a valid empty code');
    assert.deepEqual(Object.keys(c).sort(), ['active', 'id', 'lander', 'tier']);
  }
  assert.deepEqual(campaigns.map((c) => c.id), ['CODEABLEYEAR', 'LINKEDINCONNECT']);
});

test('the lander follows the campaign ID, so rotating a code does not move the page', () => {
  // The property that makes rotation cheap. LANDER_BY_CAMPAIGN is keyed by identity; if it keyed on the
  // redeemable string, every rotation would silently send that audience to the generic tier lander instead
  // of the page written for them.
  assert.equal(landerFor({ id: 'CODEABLEYEAR', code: 'ZQ7X4M2KDLPV', tier: 'member' }), '/codeable-invite/');
  assert.equal(campaignManifest(ROTATED).campaigns[0].lander, '/codeable-invite/');
  // A caller passing only a code (every caller that predates sow-291) is unchanged.
  assert.equal(landerFor({ code: 'CODEABLEYEAR', tier: 'member' }), '/codeable-invite/');
  // A campaign with no per-campaign page falls to its tier's lander, and an unknown tier gets NULL rather
  // than a plausible wrong page.
  assert.equal(landerFor({ id: 'LINKEDINCONNECT', tier: 'member' }), '/member-invite/');
  assert.equal(landerFor({ id: 'WHATEVER', tier: 'nosuchtier' }), null);
});

test('the manifest is stable, so regenerating it is a no-op diff', () => {
  // A projection that reorders on every run produces a spurious diff, and a spurious diff is how a real one
  // stops being read.
  const a = renderManifest(ROTATED);
  const b = renderManifest({ coupons: [...ROTATED.coupons].reverse() });
  assert.equal(a, b, 'manifest output must not depend on the registry order');
});

test('sow-291: the COMMITTED manifest is well-formed and carries NO code (credential-free shape guard)', () => {
  // RELOCATED from the two committed-registry tests that read house/coupons.yml directly. That file left the
  // public repository for KV (sow-291 Phase 2 deletion), and this unit suite runs on `pull_request`, which
  // executes FORK code, so it MUST stay credential-free: adding CF_API_TOKEN to read the KV registry would hand
  // a KV-write credential to anyone opening a PR (same class as pull_request_target). So the true
  // manifest-vs-registry drift guard (does the committed projection match the KV registry) moves to a
  // KV-credentialed runner: `node scripts/build-campaign-manifest.mjs --check` in reconcile.yml, which has the
  // CF creds. What stays here is the SHAPE guard, which is checkable without the registry and is what the
  // parity test and the Astro build consume: the manifest is well-formed, every campaign carries EXACTLY
  // {active,id,lander,tier} and therefore NO `code` (a bearer credential never enters the public manifest), and
  // every ACTIVE campaign resolves to a real lander (the /linkedin-invite tier-mismatch defect this exists for).
  const committed = yaml.load(read('house/campaigns.yml'));
  const campaigns = committed?.campaigns;
  assert.ok(Array.isArray(campaigns) && campaigns.length >= 3, `expected at least three campaigns, found ${campaigns?.length}`);
  for (const c of campaigns) {
    assert.deepEqual(Object.keys(c).sort(), ['active', 'id', 'lander', 'tier'],
      `campaign ${c.id} must carry EXACTLY {active,id,lander,tier} and no code`);
    assert.ok(c.id && c.tier, `campaign ${c.id} names an id and a tier`);
    if (c.active) assert.ok(landerFor({ id: c.id, tier: c.tier }), `active campaign ${c.id} must resolve a real lander`);
  }
});
