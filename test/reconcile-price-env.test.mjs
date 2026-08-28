// sow-185: the Content-Creator badge went live on 2026-08-28 (owner-questions.md Q33) by wiring the Stripe
// price ids into .github/workflows/reconcile.yml. This guard exists because of the specific way that wiring
// fails, which is neither loud nor obvious.
//
// `shouldSyncCreatorRole` (scripts/reconcile.mjs:416) gates the badge on a POPULATED price map, and
// `buildEnvPriceTierMap` (membership/tier-gate.mjs:25) builds that map from FIVE env vars: the four PRICE_ENV
// names plus the legacy STRIPE_PRICE_ID, which it seeds as CREATOR rather than as a duplicate of the four.
// That legacy id is the live $150/yr price every pre-tier paying member is on.
//
// So dropping ONE var, and specifically the fifth, does not disable the feature. It leaves the map populated,
// keeps the badge syncing, and resolves the legacy price to `none` (tierForPrice has failed closed since
// 2026-08-11), which DEMOTES every existing paying member while every test stays green and the workflow runs
// clean. There is no error anywhere in that sequence. It is the reason the wiring comment says "copy all five
// as a block; never retype one", and prose is not a control.
//
// Nothing else in the suite reads a workflow file. The .github hits elsewhere in test/ are path-string
// fixtures for the escalation gate, not file reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const NAMES = [
  'STRIPE_PRICE_ID',
  'STRIPE_PRICE_MEMBER_MONTHLY',
  'STRIPE_PRICE_MEMBER_ANNUAL',
  'STRIPE_PRICE_CREATOR_MONTHLY',
  'STRIPE_PRICE_CREATOR_ANNUAL',
];

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** name -> price id, from a workflow `env:` block (`NAME: price_x`). Comments are ignored. */
function workflowPrices(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^\s*(STRIPE_PRICE[A-Z_]*):\s*"?(price_[A-Za-z0-9]+)"?/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** name -> price id from ONE toml section, so the production set cannot be confused with the bare [vars] set. */
function tomlPrices(text, section) {
  const out = {};
  let cur = '';
  for (const line of text.split('\n')) {
    const s = /^\s*(\[[^\]]+\])/.exec(line);
    if (s) { cur = s[1]; continue; }
    const m = /^\s*(STRIPE_PRICE[A-Z_]*)\s*=\s*"(price_[A-Za-z0-9]+)"/.exec(line);
    if (m && cur === section) out[m[1]] = m[2];
  }
  return out;
}

test('sow-185: reconcile.yml carries ALL FIVE price vars, including the legacy id', () => {
  const got = workflowPrices(read('.github/workflows/reconcile.yml'));
  // Control before the claim: a broken regex must not pass by matching nothing.
  assert.equal(Object.keys(got).length, 5, `parsed ${Object.keys(got).length} price vars, expected 5`);
  for (const n of NAMES) {
    assert.ok(got[n], `${n} is missing from reconcile.yml; without it shouldSyncCreatorRole still fires and the `
      + `legacy price resolves to none, demoting every pre-tier paying member`);
  }
});

test('sow-185: reconcile.yml and pr-membership-gate.yml agree on every price id', () => {
  const rec = workflowPrices(read('.github/workflows/reconcile.yml'));
  const gate = workflowPrices(read('.github/workflows/pr-membership-gate.yml'));
  assert.equal(Object.keys(gate).length, 5, 'the gate workflow must carry the same five');
  // Compared as whole objects so an id present in one and absent from the other fails, not just a mismatch.
  assert.deepEqual(rec, gate, 'the two workflows must resolve a member to the same tier');
});

test('sow-185: the wired ids are the PRODUCTION wrangler set, not the bare [vars] set', () => {
  const toml = read('workers/signup/wrangler.toml');
  const prod = tomlPrices(toml, '[env.production.vars]');
  const dev = tomlPrices(toml, '[vars]');
  assert.equal(Object.keys(prod).length, 5, 'production section must define all five');
  assert.equal(Object.keys(dev).length, 5, 'the non-production section must also define five');
  // The two sections must actually DIFFER, or this test could not tell them apart and would pass either way.
  assert.notDeepEqual(prod, dev, 'the two wrangler sections carry the same ids, so this test cannot discriminate');

  const rec = workflowPrices(read('.github/workflows/reconcile.yml'));
  assert.deepEqual(rec, prod, 'reconcile.yml must use the production price ids');
  assert.notDeepEqual(rec, dev, 'reconcile.yml must NOT use the non-production price ids');
});
