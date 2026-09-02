// sow-213 Phase 3: the handoff of bans + grandfathered from git to KV.
//
// The hazard this file exists for: `readYaml` returns {} for a MISSING file, so a deleted house/bans.yml is
// indistinguishable, to the mirror writer, from a bans.yml that exists and is empty. Rebuilding the blob from
// that writes an EMPTY section over the live one, lifting every ban and stripping every grandfather grant, on
// a green workflow run with nothing reporting it. The first test below pins that pre-change behaviour so the
// rule underneath is measured against a real failure and not against a hypothesis.
//
// No network and no real KV: an injected fetch, and a temp checkout for the file-presence probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gitOwnedSections, buildOverridesMirror, mirrorOverridesToKv, OVERRIDES_KV_KEY,
} from '../scripts/lib/kv-mirror.mjs';
import {
  BACKED_UP_PREFIXES, collectSnapshot, encryptSnapshot, decryptSnapshot, restoreSnapshot, SNAPSHOT_KEY,
} from '../scripts/lib/kv-backup.mjs';
import { generateEpochKey } from '../client/src/crypto-assets.mjs';
import { syncOverridesMirror } from '../scripts/sync-overrides-mirror.mjs';

const NOW = new Date('2026-08-29T09:00:00.000Z');
const ENV = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };

// The shape of the LIVE blob today: entries that came from git, so they carry no `source: 'kv'` mark. This is
// what makes a one-time migration insufficient and the preservation rule necessary.
const LIVE = () => ({
  generatedAt: '2026-08-28T00:00:00.000Z',
  roles: { admins: [{ github_id: '4' }] },
  bans: { bans: [{ github_id: '7', reason: 'spam' }, { github_id: '9', reason: 'abuse' }] },
  grandfathered: { grandfathered: [{ github_id: '11', tier: 'creator' }, { github_id: '12', until: null }] },
});

function tempCheckout(files, body = '# fixture\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sow213-'));
  fs.mkdirSync(path.join(root, 'house'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, 'house', f), body);
  return root;
}

// ---------------------------------------------------------------------------------------------------------
// gitOwnedSections: ownership is DERIVED from the checkout, never configured. A flag someone has to remember
// to flip would eventually be flipped half way, in the direction that erases entitlements.
// ---------------------------------------------------------------------------------------------------------

test('gitOwnedSections reports both sections owned while both files exist', () => {
  const root = tempCheckout(['bans.yml', 'grandfathered.yml', 'roles.yml']);
  assert.deepEqual(gitOwnedSections(root), { bans: true, grandfathered: true });
});

test('gitOwnedSections reports each file independently, so a HALF-DONE flip is visible', () => {
  const root = tempCheckout(['grandfathered.yml', 'roles.yml']); // bans.yml already removed
  assert.deepEqual(gitOwnedSections(root), { bans: false, grandfathered: true });
});

test('gitOwnedSections reports both unowned when house/ carries neither file', () => {
  const root = tempCheckout(['roles.yml']);
  assert.deepEqual(gitOwnedSections(root), { bans: false, grandfathered: false });
});

// ---------------------------------------------------------------------------------------------------------
// buildOverridesMirror: the preservation rule.
// ---------------------------------------------------------------------------------------------------------

test('THE HAZARD, pinned: rebuilding a GIT-OWNED section from an absent file ERASES the live bans and grants', () => {
  // {} is exactly what readYaml yields for a deleted file. Applying GIT-OWNED ownership to it (what the write
  // path does WHILE the files exist) rebuilds the section empty, kept as a live control: if it ever stops
  // erasing, the preserve rule below is measured against nothing and every assertion in this file goes vacuous.
  // sow-213 R9: this is now the EXPLICIT git-owned value, because OMITTING ownedByGit throws (the contract test
  // below) rather than silently taking this erase path.
  const blob = buildOverridesMirror({ roles: LIVE().roles }, NOW, LIVE(), { bans: true, grandfathered: true });
  assert.deepEqual(blob.bans, {}, 'git-owned + absent file drops every ban');
  assert.deepEqual(blob.grandfathered, {}, 'git-owned + absent file drops every grant');
});

test('a section git no longer owns is preserved VERBATIM, including unmarked git-sourced entries', () => {
  const live = LIVE();
  const blob = buildOverridesMirror({ roles: live.roles }, NOW, live, { bans: false, grandfathered: false });
  assert.deepEqual(blob.bans, live.bans);
  assert.deepEqual(blob.grandfathered, live.grandfathered);
  // The entries survive WITHOUT a `source: 'kv'` mark. mergeOverridesSection would have dropped all four.
  assert.equal(blob.bans.bans.filter((e) => e.source === 'kv').length, 0);
});

test('an unowned section with NOTHING usable in KV aborts the write instead of writing empty', () => {
  const raw = { roles: {} };
  assert.throws(() => buildOverridesMirror(raw, NOW, null, { bans: false, grandfathered: false }), /refusing to write/);
  assert.throws(() => buildOverridesMirror(raw, NOW, { bans: {} }, { bans: false, grandfathered: true }), /bans/);
  assert.throws(() => buildOverridesMirror(raw, NOW, { bans: { bans: 'nope' } }, { bans: false, grandfathered: true }), /bans/);
  assert.throws(
    () => buildOverridesMirror(raw, NOW, { ...LIVE(), grandfathered: {} }, { bans: false, grandfathered: false }),
    /grandfathered\.yml is absent/,
  );
});

test('an unowned section that is legitimately EMPTY is preserved, not treated as unusable', () => {
  // Everyone unbanned is a real state and must not abort the sync forever. Unusable means "no list at all".
  const existing = { ...LIVE(), bans: { bans: [] } };
  const blob = buildOverridesMirror({ roles: {} }, NOW, existing, { bans: false, grandfathered: false });
  assert.deepEqual(blob.bans, { bans: [] });
});

test('ownership is per section: a handed-off bans list is preserved while grandfathered still merges from git', () => {
  const live = LIVE();
  const raw = { roles: live.roles, grandfathered: { grandfathered: [{ github_id: '99', tier: 'member' }] } };
  const blob = buildOverridesMirror(raw, NOW, live, { bans: false });
  assert.deepEqual(blob.bans, live.bans, 'bans came from KV');
  assert.deepEqual(blob.grandfathered.grandfathered, [{ github_id: '99', tier: 'member' }], 'grandfathered came from git');
});

test('roles are ALWAYS rebuilt from git, even when both other sections are handed off', () => {
  // roles.yml stays git-native by owner ruling: it is the root of trust for the anti-escalation model.
  const blob = buildOverridesMirror({ roles: { admins: [{ github_id: '5' }] } }, NOW, LIVE(), { bans: false, grandfathered: false });
  assert.deepEqual(blob.roles, { admins: [{ github_id: '5' }] });
});

test('generatedAt is REFRESHED in preserve mode, so the freshness guard does not stall the gate closed', () => {
  // Preserving the section but also preserving its timestamp would let the blob age past the Worker's 48h
  // window, at which point the gate fails closed and denies everyone. The stamp is not part of the payload.
  const blob = buildOverridesMirror({ roles: {} }, NOW, LIVE(), { bans: false, grandfathered: false });
  assert.equal(blob.generatedAt, NOW.toISOString());
  assert.notEqual(blob.generatedAt, LIVE().generatedAt);
});

test('a PARTIAL ownership object leaves the section it does not name GIT-OWNED', () => {
  // `undefined` is the one genuinely ambiguous input here, and the two readings differ in which direction they
  // fail. Unnamed means "unchanged from today", matching the explicit { bans: true, grandfathered: true }
  // default, so a hand-written partial cannot quietly switch a section to preserve-from-KV and stop git
  // changes (an unban among them) from ever taking effect. gitOwnedSections always returns BOTH keys, so a
  // partial only ever comes from hand-written code.
  const live = LIVE();
  // Both directions, because each section reads its own key and a one-sided check leaves the other unpinned.
  const gf = buildOverridesMirror({ roles: {}, grandfathered: { grandfathered: [{ github_id: '99' }] } }, NOW, live, { bans: false });
  assert.deepEqual(gf.grandfathered.grandfathered, [{ github_id: '99' }], 'an unnamed grandfathered still rebuilds from git');
  const bans = buildOverridesMirror({ roles: {}, bans: { bans: [{ github_id: '99' }] } }, NOW, live, { grandfathered: false });
  assert.deepEqual(bans.bans.bans, [{ github_id: '99' }], 'an unnamed bans still rebuilds from git');
});

test('sow-213 R9: OMITTING ownedByGit THROWS (this WAS the fail-open default, the erase direction by omission)', () => {
  // BEHAVIOUR CHANGE recorded, not an assertion edited green: buildOverridesMirror USED TO default ownedByGit to
  // { bans: true, grandfathered: true }, so a caller that forgot the argument silently got the rebuild-from-git
  // = erase direction. It is now REQUIRED, so omission is a throw, and the erase direction is reachable ONLY by
  // an EXPLICIT, reviewed git-owned value (the HAZARD control above), never by forgetting an argument. Prefer
  // impossible to improbable when the failure mode is silent data loss.
  const raw = { roles: { admins: [] }, bans: { bans: [{ github_id: '7' }] }, grandfathered: { grandfathered: [] } };
  assert.throws(() => buildOverridesMirror(raw, NOW, null), /ownedByGit is required/);
  // The explicit git-owned value still produces the pre-change blob (the migration changed the CONTRACT, not the
  // git-owned behaviour).
  const explicit = buildOverridesMirror(raw, NOW, null, { bans: true, grandfathered: true });
  assert.deepEqual(explicit.bans, raw.bans);
  assert.deepEqual(explicit.grandfathered, raw.grandfathered);
});

// ---------------------------------------------------------------------------------------------------------
// mirrorOverridesToKv: the rule end to end, over the REST shape the reconcile actually uses.
// ---------------------------------------------------------------------------------------------------------

/** A fetch fake answering the read with `current` and recording every PUT. */
function kvFake(current) {
  const puts = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'PUT') { puts.push({ url, body: init.body }); return { ok: true }; }
    if (current == null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, json: async () => current };
  };
  return { puts, fetchImpl };
}

test('mirrorOverridesToKv PUTs the PRESERVED entries once git no longer owns the files', async () => {
  const live = LIVE();
  const kv = kvFake(live);
  const r = await mirrorOverridesToKv({
    raw: { roles: live.roles }, env: ENV, now: NOW, fetchImpl: kv.fetchImpl,
    ownedByGit: { bans: false, grandfathered: false },
  });
  assert.equal(r.written, true);
  assert.equal(r.key, OVERRIDES_KV_KEY);
  assert.equal(kv.puts.length, 1);
  const body = JSON.parse(kv.puts[0].body);
  assert.deepEqual(body.bans.bans.map((e) => e.github_id).sort(), ['7', '9']);
  assert.deepEqual(body.grandfathered.grandfathered.map((e) => e.github_id).sort(), ['11', '12']);
  assert.equal(body.grandfathered.grandfathered.find((e) => e.github_id === '11').tier, 'creator');
});

test('mirrorOverridesToKv issues NO PUT AT ALL when there is nothing usable to preserve', async () => {
  // An abort that still writes is worse than no abort: it looks like a caught error and erases anyway.
  const kv = kvFake({ generatedAt: '2026-08-28T00:00:00.000Z', roles: {} }); // a blob with no bans section
  await assert.rejects(
    () => mirrorOverridesToKv({ raw: {}, env: ENV, now: NOW, fetchImpl: kv.fetchImpl, ownedByGit: { bans: false, grandfathered: false } }),
    /refusing to write/,
  );
  assert.equal(kv.puts.length, 0, 'no write was attempted');
});

// ---------------------------------------------------------------------------------------------------------
// The wiring. The rule is worthless if the 6-hourly job does not pass ownership down to it, and that call
// site is one argument that is easy to lose in a rebase.
// ---------------------------------------------------------------------------------------------------------

test('the 6-hourly sync PRESERVES the sections whose files are gone from the checkout it reads', async () => {
  // A checkout after Phase 3: roles.yml only. loadOverridesRaw yields {} for the two deleted files, which is
  // precisely the input that erased them before this rule existed.
  const root = tempCheckout(['roles.yml'], 'admins:\n  - github_id: "4"\n');
  const live = LIVE();
  const kv = kvFake(live);
  const r = await syncOverridesMirror({ root, env: ENV, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(r.written, true);
  assert.equal(kv.puts.length, 1);
  const body = JSON.parse(kv.puts[0].body);
  assert.deepEqual(body.bans, live.bans, 'the deleted bans.yml did not erase the live bans');
  assert.deepEqual(body.grandfathered, live.grandfathered, 'the deleted grandfathered.yml did not erase the live grants');
  assert.deepEqual(body.roles, { admins: [{ github_id: '4' }] }, 'roles still come from git');
  // The freshness stamp is what keeps six readers from failing closed at the 48h mark once git stops being the
  // source. The job still runs on its cron after Phase 3, so this is the thing that must keep moving.
  assert.equal(body.generatedAt, NOW.toISOString());
});

test('the sync still rebuilds from git for a section whose file is PRESENT', async () => {
  const root = tempCheckout(['roles.yml', 'bans.yml', 'grandfathered.yml'], 'bans:\n  - github_id: "42"\n');
  const kv = kvFake(LIVE());
  await syncOverridesMirror({ root, env: ENV, fetchImpl: kv.fetchImpl, now: NOW });
  const body = JSON.parse(kv.puts[0].body);
  assert.deepEqual(body.bans.bans, [{ github_id: '42' }], 'a present bans.yml is still authoritative');
});

// ---------------------------------------------------------------------------------------------------------
// The backup. Acceptance criterion 4: a restore reproduces the live blob BYTE FOR BYTE.
// ---------------------------------------------------------------------------------------------------------

test('overrides: is in the backup set, because Phase 3 removes the source it was regenerable from', () => {
  assert.ok(BACKED_UP_PREFIXES.includes('overrides:'), 'the only copy of ban + grant state must be backed up');
});

test('a backup restore reproduces the overrides blob byte for byte', async () => {
  // Deliberately NOT canonical JSON: indented, non-alphabetical keys, a non-ASCII reason. If any layer parses
  // and re-serializes on the way through, the restored string stops matching and this test reds. Comparing
  // parsed objects would pass through such a layer and prove nothing about the bytes.
  const RAW_BLOB = '{\n  "generatedAt": "2026-08-29T00:00:00.000Z",\n  "bans": { "bans": [ {"github_id":"7","reason":"repeated spam \\u2014 final"} ] },\n  "roles": {},\n  "grandfathered": { "grandfathered": [ {"github_id":"11","tier":"creator","login":"müller"} ] }\n}';
  assert.notEqual(JSON.stringify(JSON.parse(RAW_BLOB)), RAW_BLOB, 'the fixture must not survive a re-serialize, or the test is vacuous');

  const source = new Map([[OVERRIDES_KV_KEY, RAW_BLOB], ['activity:1', '{"favorites":[]}']]);
  const target = new Map();
  const restKv = (store) => async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/keys')) {
      const prefix = u.searchParams.get('prefix') || '';
      return { ok: true, json: async () => ({ result: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), result_info: { cursor: '' } }) };
    }
    const key = decodeURIComponent(u.pathname.match(/\/values\/(.+)$/)[1]);
    if (init.method === 'PUT') { store.set(key, init.body); return { ok: true }; }
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, text: async () => store.get(key) };
  };

  const collected = await collectSnapshot({ env: ENV, fetchImpl: restKv(source), now: NOW });
  assert.equal(collected.available, true);
  assert.ok(collected.snapshot.records.some((r) => r.key === OVERRIDES_KV_KEY), 'the overrides blob was collected');

  const key = generateEpochKey();
  const envelope = await encryptSnapshot({ snapshot: collected.snapshot, key, snapshotId: SNAPSHOT_KEY(collected.snapshot.takenAt) });
  assert.ok(!JSON.stringify(envelope).includes('github_id'), 'the backup does not expose ban records in the clear');

  const back = await decryptSnapshot({ envelope, key });
  const res = await restoreSnapshot({ env: ENV, fetchImpl: restKv(target), snapshot: back });
  assert.equal(res.restored, back.records.length);
  assert.equal(target.get(OVERRIDES_KV_KEY), RAW_BLOB, 'the restored blob is identical, character for character');
});
