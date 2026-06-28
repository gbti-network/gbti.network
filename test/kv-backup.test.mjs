// SOW-024: encrypted, retention-bounded KV backups. Tests the snapshot shape, the encrypt/decrypt round-trip
// (real WebCrypto in node), the TTL store, the no-op-without-creds/key paths, and restore -- all with a fake
// fetch + a generated key (no network, no secrets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshot, collectSnapshot, encryptSnapshot, decryptSnapshot, takeBackup, listSnapshots,
  readSnapshot, restoreSnapshot, verifyLatestBackup, SNAPSHOT_KEY, BACKUP_PREFIX, DEFAULT_RETENTION_SECONDS,
} from '../scripts/lib/kv-backup.mjs';
import { generateEpochKey, AssetAccessError } from '../client/src/crypto-assets.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const KEY = generateEpochKey(); // a real 32-byte base64 AES key
const NOW = new Date('2026-06-13T12:00:00.000Z');

// A fake KV-over-REST: an in-memory store the CF REST shape reads/writes. `failGet` keys return a 500 on GET.
function fakeKv(initial = {}, { failGet = [] } = {}) {
  const store = new Map(Object.entries(initial));
  const fail = new Set(failGet);
  const puts = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/keys')) {
      const prefix = u.searchParams.get('prefix') || '';
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { ok: true, json: async () => ({ result: names, result_info: { cursor: '' } }) };
    }
    const m = u.pathname.match(/\/values\/(.+)$/);
    const key = m ? decodeURIComponent(m[1]) : null;
    if (init.method === 'PUT') {
      puts.push({ key, ttl: u.searchParams.get('expiration_ttl'), value: init.body });
      store.set(key, init.body);
      return { ok: true };
    }
    // GET value
    if (fail.has(key)) return { ok: false, status: 500, text: async () => 'server error' }; // transient API error
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, text: async () => store.get(key) };
  };
  return { store, puts, fetchImpl };
}

test('buildSnapshot shapes a versioned, counted, timestamped blob', () => {
  const s = buildSnapshot([{ key: 'activity:1', value: '{}' }], NOW);
  assert.equal(s.v, 1);
  assert.equal(s.count, 1);
  assert.equal(s.takenAt, NOW.toISOString());
});

test('collectSnapshot gathers activity:/follows:/prefs:/conv: and is a no-op without creds', async () => {
  const kv = fakeKv({
    'activity:1': '{"favorites":[]}', 'follows:2': '{"following":[]}', 'prefs:4': '{}', 'conv:5': '{"member":"5"}',
    'earnings:6': '{}', 'touch:7': '{}', 'gh:3': 'cus_x', 'overrides:mirror': '{}',
  });
  const c = await collectSnapshot({ env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(c.available, true);
  const keys = c.snapshot.records.map((r) => r.key).sort();
  // conv: (irreplaceable money attribution) + prefs: are now backed up; earnings: (recomputable), touch: (ephemeral),
  // gh: + overrides:mirror (regenerable) are NOT.
  assert.deepEqual(keys, ['activity:1', 'conv:5', 'follows:2', 'prefs:4']);
  const none = await collectSnapshot({ env: {}, fetchImpl: async () => { throw new Error('no fetch'); } });
  assert.equal(none.available, false);
  assert.match(none.reason, /CF_ACCOUNT_ID/);
});

test('encrypt/decrypt round-trips a snapshot and a wrong key is access-denied', async () => {
  const snap = buildSnapshot([{ key: 'activity:1', value: '{"favorites":[{"type":"post","slug":"x"}]}' }], NOW);
  const env = await encryptSnapshot({ snapshot: snap, key: KEY, snapshotId: SNAPSHOT_KEY(snap.takenAt) });
  // The envelope is opaque ciphertext, not the plaintext.
  assert.ok(!JSON.stringify(env).includes('favorites'), 'ciphertext does not expose the data');
  const back = await decryptSnapshot({ envelope: env, key: KEY });
  assert.deepEqual(back, snap);
  await assert.rejects(() => decryptSnapshot({ envelope: env, key: generateEpochKey() }), AssetAccessError);
});

test('takeBackup stores an encrypted snapshot at backup:<iso> with a retention TTL', async () => {
  const kv = fakeKv({ 'activity:1': '{"favorites":[]}', 'follows:2': '{"following":[]}' });
  const r = await takeBackup({ env: CF, fetchImpl: kv.fetchImpl, now: NOW, key: KEY, retentionSeconds: 14 * 86400 });
  assert.equal(r.stored, true);
  assert.equal(r.key, SNAPSHOT_KEY(NOW.toISOString()));
  assert.equal(r.count, 2);
  const put = kv.puts.find((p) => p.key.startsWith(BACKUP_PREFIX));
  assert.equal(put.ttl, String(14 * 86400), 'retention TTL applied');
  // What landed in KV is an encrypted envelope, not plaintext member data.
  assert.ok(!put.value.includes('following'), 'stored value is encrypted');
  assert.ok(JSON.parse(put.value).ct, 'stored value is an envelope with ciphertext');
});

test('takeBackup is a reported no-op without CF creds or KV_BACKUP_KEY', async () => {
  assert.match((await takeBackup({ env: {}, key: KEY, fetchImpl: async () => { throw new Error('x'); } })).reason, /CF_ACCOUNT_ID/);
  const kv = fakeKv({ 'activity:1': '{}' });
  assert.match((await takeBackup({ env: CF, fetchImpl: kv.fetchImpl, key: undefined })).reason, /KV_BACKUP_KEY/);
});

test('a transient API error during collect THROWS (never a silently incomplete backup)', async () => {
  // activity:2 is present but its GET 500s; the backup must abort, not drop the record and report success.
  const kv = fakeKv({ 'activity:1': '{"favorites":[]}', 'activity:2': '{"favorites":[]}' }, { failGet: ['activity:2'] });
  await assert.rejects(() => collectSnapshot({ env: CF, fetchImpl: kv.fetchImpl }), /KV get failed: 500/);
  await assert.rejects(() => takeBackup({ env: CF, fetchImpl: kv.fetchImpl, key: KEY }), /KV get failed: 500/);
  assert.ok(!kv.puts.some((p) => p.key.startsWith(BACKUP_PREFIX)), 'nothing was stored on a failed collect');
});

test('takeBackup clamps a 0 / negative retention to the default (never stores an unbounded backup)', async () => {
  const kv = fakeKv({ 'activity:1': '{}' });
  const r = await takeBackup({ env: CF, fetchImpl: kv.fetchImpl, now: NOW, key: KEY, retentionSeconds: 0 });
  assert.equal(r.stored, true);
  assert.equal(r.ttlSeconds, DEFAULT_RETENTION_SECONDS);
  const put = kv.puts.find((p) => p.key.startsWith(BACKUP_PREFIX));
  assert.equal(put.ttl, String(DEFAULT_RETENTION_SECONDS), 'a positive retention TTL is always applied');
});

test('listSnapshots returns the backup: keys, sorted', async () => {
  const kv = fakeKv({ 'backup:2026-06-12T00:00:00.000Z': 'x', 'backup:2026-06-13T00:00:00.000Z': 'y', 'activity:1': '{}' });
  const r = await listSnapshots({ env: CF, fetchImpl: kv.fetchImpl });
  assert.deepEqual(r.keys, ['backup:2026-06-12T00:00:00.000Z', 'backup:2026-06-13T00:00:00.000Z']);
});

test('readSnapshot + restoreSnapshot round-trip member keys back into KV', async () => {
  // Take a backup, wipe the live keys, then restore from the snapshot.
  const kv = fakeKv({ 'activity:1': '{"favorites":[1]}', 'follows:2': '{"following":[2]}' });
  await takeBackup({ env: CF, fetchImpl: kv.fetchImpl, now: NOW, key: KEY });
  kv.store.delete('activity:1');
  kv.store.delete('follows:2');

  const read = await readSnapshot({ env: CF, fetchImpl: kv.fetchImpl, snapshotKey: SNAPSHOT_KEY(NOW.toISOString()), key: KEY });
  assert.equal(read.available, true);
  assert.equal(read.snapshot.count, 2);
  const out = await restoreSnapshot({ env: CF, fetchImpl: kv.fetchImpl, snapshot: read.snapshot });
  assert.equal(out.restored, 2);
  assert.equal(kv.store.get('activity:1'), '{"favorites":[1]}');
  assert.equal(kv.store.get('follows:2'), '{"following":[2]}');
});

test('readSnapshot reports a missing snapshot and a missing key', async () => {
  const kv = fakeKv({});
  assert.match((await readSnapshot({ env: CF, fetchImpl: kv.fetchImpl, snapshotKey: 'backup:nope', key: KEY })).reason, /not found/);
  assert.match((await readSnapshot({ env: CF, fetchImpl: kv.fetchImpl, snapshotKey: 'backup:x', key: undefined })).reason, /KV_BACKUP_KEY/);
});

// ---- SOW-084: off-namespace export + verify ----

test('takeBackup returns the encrypted envelope; the off-namespace copy round-trips (decrypt -> restore)', async () => {
  const kv = fakeKv({ 'activity:1': '{"favorites":[1]}', 'conv:5': '{"member":"5"}' });
  const r = await takeBackup({ env: CF, fetchImpl: kv.fetchImpl, now: NOW, key: KEY });
  assert.equal(r.stored, true);
  assert.ok(r.envelope && r.envelope.ct, 'returns the encrypted envelope for an off-namespace artifact');
  // Simulate a whole-namespace loss: wipe everything, then restore purely from the exported envelope.
  kv.store.clear();
  const snap = await decryptSnapshot({ envelope: r.envelope, key: KEY });
  assert.equal(snap.count, 2);
  const out = await restoreSnapshot({ env: CF, fetchImpl: kv.fetchImpl, snapshot: snap });
  assert.equal(out.restored, 2);
  assert.equal(kv.store.get('conv:5'), '{"member":"5"}');
});

test('verifyLatestBackup confirms the newest snapshot is restorable; catches none + a wrong key', async () => {
  const kv = fakeKv({ 'activity:1': '{"favorites":[1]}', 'follows:2': '{"following":[2]}' });
  assert.match((await verifyLatestBackup({ env: CF, fetchImpl: kv.fetchImpl, key: KEY })).reason, /no snapshots/);
  await takeBackup({ env: CF, fetchImpl: kv.fetchImpl, now: NOW, key: KEY });
  const ok = await verifyLatestBackup({ env: CF, fetchImpl: kv.fetchImpl, key: KEY });
  assert.equal(ok.ok, true);
  assert.equal(ok.count, 2);
  const bad = await verifyLatestBackup({ env: CF, fetchImpl: kv.fetchImpl, key: generateEpochKey() }); // wrong key -> the broken-backup alarm
  assert.equal(bad.ok, false);
});
