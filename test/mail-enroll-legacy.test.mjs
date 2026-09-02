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
test('R6 EQUIVALENCE: reading KV yields the SAME allow-set the git file would (correct-base check)', async () => {
  const gitPath = fileURLToPath(new URL('../house/grandfathered.yml', import.meta.url));
  const parsed = yaml.load(fs.readFileSync(gitPath, 'utf8'));
  const gitEntries = parsed?.grandfathered ?? [];
  assert.ok(gitEntries.length > 0, 'house/grandfathered.yml must be present with entries; a stale base fails here');
  const gitAllowSet = gitEntries
    .map((g) => ({ githubId: String(g?.github_id ?? '').trim(), login: String(g?.login ?? '').trim() }))
    .filter((g) => g.githubId && g.login);
  const kvAllowSet = await grandfatheredAllowSet({ env: ENV, fetchImpl: fetchOk(mirror(gitEntries)) });
  assert.deepEqual(kvAllowSet, gitAllowSet, 'the KV-mirror allow-set must equal the git-file allow-set exactly');
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
