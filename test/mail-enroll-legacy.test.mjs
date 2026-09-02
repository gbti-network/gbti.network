// sow-213 Step 2 (R6): the legacy-enrolment allow-set now reads the KV overrides mirror, not
// house/grandfathered.yml. Built on the CORRECT base (post-revert, both files present), so the equivalence that
// IS the claim of a reader migration can actually be tested: the KV read must yield the SAME allow-set the git
// file would. Fail-closed on an unavailable/stale/malformed mirror. Injected fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { grandfatheredAllowSet } from '../scripts/mail-enroll-legacy.mjs';

const ENV = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const mirror = (grandfathered, generatedAt = new Date().toISOString()) => ({
  generatedAt, roles: {}, bans: { bans: [] }, grandfathered: { grandfathered },
});
const fetchOk = (blob) => async () => ({ ok: true, status: 200, json: async () => blob });

// THE EQUIVALENCE TEST, meaningful only on the correct base (the git file present). It reads the REAL
// house/grandfathered.yml, builds a mirror from the SAME entries, and asserts the migrated KV read produces the
// IDENTICAL allow-set the git file would have. The length guard makes a STALE base (file absent -> {} -> 0
// entries) FAIL LOUDLY here rather than passing trivially, which is exactly the trap that invalidated the first
// attempt (band seq 78).
test('R6: the KV allow-set applies the SAME github_id+login filter the git-era allow-set did', async () => {
  // BEHAVIOUR CHANGE recorded: this used to read the real house/grandfathered.yml and prove the KV read yields
  // an IDENTICAL allow-set (a Step-2 transition correct-base check). Step 3 deletes that file, so there is no git
  // side to compare against any more; the filter equivalence is pinned against a fixture instead. The derivation
  // (github_id AND login required, trimmed) is unchanged, only its source moved to KV.
  const entries = [
    { github_id: '11', login: 'alice' },
    { github_id: '12', login: 'bob', until: null },
    { github_id: '13' }, // no login -> dropped
    { login: 'noid' },   // no id -> dropped
  ];
  const kvAllowSet = await grandfatheredAllowSet({ env: ENV, fetchImpl: fetchOk(mirror(entries)) });
  assert.deepEqual(kvAllowSet, [{ githubId: '11', login: 'alice' }, { githubId: '12', login: 'bob' }], 'the same filter, sourced from KV');
  assert.ok(kvAllowSet.length > 0, 'and it is non-trivially non-empty');
});

test('R6: grandfatheredAllowSet reads the allow-set from the KV mirror', async () => {
  const blob = mirror([{ github_id: '11', login: 'alice' }, { github_id: '12', login: 'bob' }]);
  const set = await grandfatheredAllowSet({ env: ENV, fetchImpl: fetchOk(blob) });
  assert.deepEqual(set, [{ githubId: '11', login: 'alice' }, { githubId: '12', login: 'bob' }]);
});

test('R6: entries missing github_id or login are dropped (same filter as the git-era allow-set)', async () => {
  const blob = mirror([{ github_id: '11', login: 'alice' }, { github_id: '12' }, { login: 'noid' }]);
  const set = await grandfatheredAllowSet({ env: ENV, fetchImpl: fetchOk(blob) });
  assert.deepEqual(set, [{ githubId: '11', login: 'alice' }]);
});

test('R6 FAIL CLOSED: a STALE mirror (>48h) throws, never an empty allow-set', async () => {
  const stale = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const blob = mirror([{ github_id: '11', login: 'alice' }], stale);
  await assert.rejects(grandfatheredAllowSet({ env: ENV, fetchImpl: fetchOk(blob) }), /cannot read the grandfathered set/);
});

test('R6 FAIL CLOSED: missing CF credentials throws', async () => {
  await assert.rejects(grandfatheredAllowSet({ env: {}, fetchImpl: fetchOk(mirror([])) }), /cannot read the grandfathered set/);
});

test('R6 FAIL CLOSED: a KV read error (non-200) throws', async () => {
  await assert.rejects(grandfatheredAllowSet({ env: ENV, fetchImpl: async () => ({ ok: false, status: 500 }) }), /cannot read the grandfathered set/);
});
