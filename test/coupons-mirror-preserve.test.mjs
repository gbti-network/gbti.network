// sow-291 Phase 2: the coupon mirror must not be able to erase the coupon registry.
//
// THE DEFECT. `toCouponsMirror` rebuilt `coupons:config` wholesale from `house/coupons.yml`, and both writers
// read that file as `try { load } catch { rawCoupons = {} }`. So a missing, renamed or unparseable registry did
// not fail the job: it mirrored an EMPTY coupon list over the live one at the next six-hourly tick, on a GREEN
// Action run, because `written` only reports that the PUT succeeded. Every invite link in circulation would go
// quiet inside six hours, and an unredeemable coupon drops SILENTLY at signup (workers/signup/index.mjs:311),
// so the first sign of it would be nobody converting.
//
// This is sow-213's hazard on a different store, so it takes sow-213's fix: a PROPERTY RATHER THAN A
// DISCIPLINE. Nothing here depends on anyone remembering an ordering at the moment the writers invert.
//
// The general rule these tests encode, from SecurityMaster on 2026-08-29: A DATA OPERATION CANNOT FIX A RULE
// THAT RUNS AGAIN AFTERWARDS. Migrating the campaigns into KV once and then flipping the writer leaves the old
// writer still scheduled, and its next run rebuilds from git over the top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { toCouponsMirror, mergeCouponsList, couponsFromParsed } from '../membership/coupons.mjs';
import { loadCouponsRaw, mirrorCouponsToKv } from '../scripts/lib/kv-mirror.mjs';

const AT = new Date('2026-08-29T12:00:00Z');
const GIT = { coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'member' }] };
const KV_NATIVE = { code: 'MINTEDINKV', freeDays: 365, active: true, tier: 'member', source: 'kv' };

/** A temp checkout with an optional house/coupons.yml, so the ownership rule is exercised on real files. */
function checkout(couponsYmlText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sow291-'));
  fs.mkdirSync(path.join(root, 'house'));
  if (couponsYmlText !== null) fs.writeFileSync(path.join(root, 'house', 'coupons.yml'), couponsYmlText);
  return root;
}

test('a KV-native coupon SURVIVES a sync that rebuilds from git', () => {
  // The property the whole phase rests on. Without it, minting a coupon in KV works and then stops within six
  // hours, which is the worst available failure: it looks like success at the moment anyone would check.
  const before = toCouponsMirror(GIT, AT, { coupons: [...couponsFromParsed(GIT).values(), KV_NATIVE] });
  const codes = before.coupons.map((c) => c.code).sort();
  assert.deepEqual(codes, ['CODEABLEYEAR', 'MINTEDINKV']);

  // And the control, so this is not passing because the merge returns its input untouched: with the SAME
  // existing blob but the entry unmarked, it must be dropped.
  const unmarked = { ...KV_NATIVE, source: undefined };
  const after = toCouponsMirror(GIT, AT, { coupons: [...couponsFromParsed(GIT).values(), unmarked] });
  assert.deepEqual(after.coupons.map((c) => c.code), ['CODEABLEYEAR'],
    'an UNMARKED existing entry must be dropped, or a removal in git would stop taking effect');
});

test('git still wins on a code it carries, so deactivating in git keeps working', () => {
  // The other direction, and the reason the merge cannot simply union. If a stale KV copy could shadow the git
  // entry, deactivating a coupon in git would leave it redeemable, which is a fail-OPEN.
  const staleActive = { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'member', source: 'kv' };
  const gitDeactivated = { coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: false, tier: 'member' }] };
  const m = toCouponsMirror(gitDeactivated, AT, { coupons: [staleActive] });
  assert.equal(m.coupons.length, 1);
  assert.equal(m.coupons[0].active, false, 'the git entry must win for a code git carries');
});

test('an ABSENT registry preserves KV verbatim instead of rebuilding it empty', () => {
  // The Phase 2 flip. `couponsFromParsed({})` is empty and indistinguishable from a file that exists and holds
  // no coupons, so rebuilding here is the erase this exists to prevent.
  const live = { coupons: [KV_NATIVE] };
  const m = toCouponsMirror({}, AT, live, false);
  assert.deepEqual(m.coupons, [KV_NATIVE]);
  assert.equal(m.generatedAt, AT.toISOString(), 'the stamp is still REFRESHED, or the blob ages past the 48h gate');
});

test('an absent registry with NO ARRAY AT ALL aborts; an EMPTY array is a legitimate state', () => {
  // The abort costs a skipped refresh, which the Worker's 48h window absorbs and which then fails coupons
  // CLOSED, loudly (the six-hourly job reds four times a day). It exists for ONE case: a Phase 2 flip
  // performed before KV was populated, which reads back as a 404 or a blob of another shape.
  assert.throws(() => toCouponsMirror({}, AT, null, false), /no coupon registry to preserve/);
  assert.throws(() => toCouponsMirror({}, AT, {}, false), /no coupon registry to preserve/);
  assert.throws(() => toCouponsMirror({}, AT, { coupons: 'nope' }, false), /no coupon registry to preserve/);

  // But an EMPTY registry is not a fault, and this aborted on it until SecurityMaster pointed out that the
  // abort buys nothing there: zero coupons already means nothing is redeemable, so refusing to write protects
  // nothing and only makes "every campaign has ended" unreachable. Under the old rule that legitimate admin
  // action would have red the six-hourly job four times a day forever, and that job also carries the overrides
  // mirror, so the noise would land on a check that matters.
  const m = toCouponsMirror({}, AT, { coupons: [] }, false);
  assert.deepEqual(m.coupons, []);
  assert.equal(m.generatedAt, AT.toISOString(), 'and the stamp still refreshes, so the blob does not age out');
});

test('loadCouponsRaw distinguishes ABSENT from UNPARSEABLE, which the old catch collapsed', () => {
  const present = checkout('coupons:\n  - code: CODEABLEYEAR\n    freeDays: 365\n    active: true\n    tier: member\n');
  const r = loadCouponsRaw(present);
  assert.equal(r.ownedByGit, true);
  assert.equal(couponsFromParsed(r.raw).size, 1, 'the control: a readable file parses to its coupons');

  const absent = checkout(null);
  assert.deepEqual(loadCouponsRaw(absent), { raw: {}, ownedByGit: false });

  // The live fragility, independent of the migration: a bad YAML edit merged into house/coupons.yml used to
  // mirror an empty registry within six hours. It must now throw.
  const broken = checkout('coupons:\n  - code: X\n   bad indent: [unclosed\n');
  assert.throws(() => loadCouponsRaw(broken), /not valid YAML/);
});

test('the writer READS before it writes, and a failed read ABORTS', async () => {
  // "We could not read the current coupons" must never resolve to "overwrite them". This is the fail-open
  // collapse that has cost this repo the most, so it is asserted rather than trusted to the comment.
  const env = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init?.method || 'GET');
    if ((init?.method || 'GET') === 'GET') return { ok: false, status: 500 };
    return { ok: true };
  };
  await assert.rejects(() => mirrorCouponsToKv({ raw: GIT, env, fetchImpl }), /refusing to overwrite an unknown coupon registry/);
  assert.deepEqual(calls, ['GET'], 'the PUT must NOT have been attempted after a failed read');
});

test('a first write with no existing blob (404) still succeeds', async () => {
  // The abort above must not make the legitimate first write impossible, or the guard would be unshippable.
  const env = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
  let put = null;
  const fetchImpl = async (url, init) => {
    if ((init?.method || 'GET') === 'GET') return { ok: false, status: 404 };
    put = JSON.parse(init.body);
    return { ok: true };
  };
  const r = await mirrorCouponsToKv({ raw: GIT, env, fetchImpl });
  assert.equal(r.written, true);
  assert.deepEqual(put.coupons.map((c) => c.code), ['CODEABLEYEAR']);
});

test('mergeCouponsList is order-stable and drops an entry with no code', () => {
  // A KV entry with no code cannot be redeemed and cannot be deduplicated, so carrying it forward would grow
  // the blob forever with records nothing can ever match.
  const merged = mergeCouponsList([{ code: 'A' }], [{ source: 'kv' }, { code: 'B', source: 'kv' }]);
  assert.deepEqual(merged.map((c) => c.code), ['A', 'B']);
});
