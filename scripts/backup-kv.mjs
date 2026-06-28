// SOW-024 + SOW-084: the encrypted, retention-bounded KV backup CLI. Snapshots the KV-only member data (favorites +
// collections + the follow graph + prefs + the SOW-059 conv: attribution snapshots), encrypts it (AES-256-GCM,
// dedicated KV_BACKUP_KEY), and stores it at `backup:<iso>` with a retention TTL so erased data ages out within the
// window. SOW-084 adds an OFF-NAMESPACE export (so a whole-namespace loss is survivable), restore-from-file, + verify.
//
// Usage:
//   node scripts/backup-kv.mjs                       # dry-run: report what would be backed up (no write)
//   node scripts/backup-kv.mjs --apply               # take + store an encrypted snapshot (default 30d retention)
//   node scripts/backup-kv.mjs --apply --export out.enc          # ...AND write the encrypted snapshot off-namespace
//   node scripts/backup-kv.mjs --apply --retention-days 14
//   node scripts/backup-kv.mjs --list                # list stored snapshot keys
//   node scripts/backup-kv.mjs --verify              # decrypt the LATEST snapshot to prove it is restorable
//   node scripts/backup-kv.mjs --restore backup:<iso> --apply    # decrypt + restore that in-KV snapshot
//   node scripts/backup-kv.mjs --restore-file out.enc --apply    # restore from an OFF-namespace export (DR)
//
// Needs CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN (the SIGNUP_KV account) and KV_BACKUP_KEY (a stable
// 32-byte base64 AES key). Missing creds/key is a reported no-op, never a silent success. Mint a key with:
//   node -e "import('./client/src/crypto-assets.mjs').then(m => console.log(m.generateEpochKey()))"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot, takeBackup, listSnapshots, readSnapshot, restoreSnapshot, decryptSnapshot, verifyLatestBackup, DEFAULT_RETENTION_SECONDS } from './lib/kv-backup.mjs';

export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const days = get('--retention-days');
  return {
    apply: argv.includes('--apply'),
    list: argv.includes('--list'),
    verify: argv.includes('--verify'),
    restore: get('--restore'),
    restoreFile: get('--restore-file'),
    exportFile: get('--export'),
    retentionSeconds: days && Number(days) > 0 ? Math.floor(Number(days)) * 24 * 60 * 60 : DEFAULT_RETENTION_SECONDS,
  };
}

const restoreCaveat = (takenAt) =>
  `CAVEAT: restoring can RE-INTRODUCE data for a member erased AFTER ${takenAt}. Re-run erase-member.mjs --apply for anyone erased since then.`;

async function main() {
  const { apply, list, verify, restore, restoreFile, exportFile, retentionSeconds } = parseArgs(process.argv.slice(2));
  const env = process.env;

  if (list) {
    const r = await listSnapshots({ env });
    if (!r.available) { console.log(`backup: cannot list (${r.reason}).`); return; }
    console.log(`backup: ${r.keys.length} snapshot(s):`);
    for (const k of r.keys) console.log(`  ${k}`);
    return;
  }

  if (verify) {
    const r = await verifyLatestBackup({ env });
    if (r.ok) { console.log(`backup: latest snapshot ${r.snapshotKey} is RESTORABLE (${r.count} key(s), taken ${r.takenAt}).`); return; }
    console.error(`backup: VERIFY FAILED (${r.reason}).`);
    process.exitCode = 1;
    return;
  }

  if (restoreFile) {
    let envelope;
    try { envelope = JSON.parse(fs.readFileSync(restoreFile, 'utf8')); }
    catch (e) { console.error(`backup: cannot read ${restoreFile} (${e.message}).`); process.exitCode = 1; return; }
    if (!env.KV_BACKUP_KEY) { console.error('backup: KV_BACKUP_KEY not set.'); process.exitCode = 1; return; }
    let snapshot;
    try { snapshot = await decryptSnapshot({ envelope, key: env.KV_BACKUP_KEY }); }
    catch { console.error(`backup: cannot decrypt ${restoreFile} (wrong KV_BACKUP_KEY or tampered).`); process.exitCode = 1; return; }
    console.log(`backup: off-namespace snapshot holds ${snapshot.count} key(s), taken ${snapshot.takenAt}.`);
    console.log(restoreCaveat(snapshot.takenAt));
    if (!apply) { console.log('Dry-run: re-run with --apply to write these keys back into KV.'); return; }
    const out = await restoreSnapshot({ env, snapshot });
    console.log(`backup: restored ${out.restored} key(s)${out.reason ? ` (${out.reason})` : ''}.`);
    return;
  }

  if (restore) {
    const r = await readSnapshot({ env, snapshotKey: restore });
    if (!r.available) { console.error(`backup: cannot read ${restore} (${r.reason}).`); process.exitCode = 1; return; }
    console.log(`backup: snapshot ${restore} holds ${r.snapshot.count} key(s), taken ${r.snapshot.takenAt}.`);
    console.log(restoreCaveat(r.snapshot.takenAt));
    if (!apply) { console.log('Dry-run: re-run with --apply to write these keys back into KV.'); return; }
    const out = await restoreSnapshot({ env, snapshot: r.snapshot });
    console.log(`backup: restored ${out.restored} key(s)${out.reason ? ` (${out.reason})` : ''}.`);
    return;
  }

  // Default + --apply: snapshot the member data.
  if (!apply) {
    const c = await collectSnapshot({ env });
    if (!c.available) { console.log(`backup: DRY-RUN cannot collect (${c.reason}).`); return; }
    const bytes = JSON.stringify(c.snapshot).length;
    console.log(`backup: DRY-RUN would snapshot ${c.snapshot.count} key(s) (~${bytes} bytes), encrypt, and store at backup:<iso> with ${retentionSeconds / 86400}d retention. Re-run with --apply.`);
    return;
  }

  const r = await takeBackup({ env, retentionSeconds });
  if (!r.stored) { console.log(`backup: SKIPPED (${r.reason}).`); return; }
  console.log(`backup: stored ${r.key} (${r.count} key(s), ${r.ttlSeconds / 86400}d retention, encrypted).`);
  if (exportFile) {
    fs.writeFileSync(exportFile, JSON.stringify(r.envelope));
    console.log(`backup: also exported the encrypted snapshot to ${exportFile} (off-namespace copy; still encrypted).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('backup: failed:', err?.message ?? err);
    process.exit(1);
  });
}
