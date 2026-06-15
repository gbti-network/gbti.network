#!/usr/bin/env node
// SOW-015 P5: rotate the member-content epoch key. Mints a new epoch, re-encrypts every still-published .enc
// asset under it (same asset id as AAD), and prints what the operator must set in the Worker. Admin-run,
// locally. Dry-run by default.
//
//   MEMBER_CONTENT_KEY=<old base64> node scripts/rotate-member-key.mjs --new-kid 2            # dry run
//   MEMBER_CONTENT_KEY=<old base64> node scripts/rotate-member-key.mjs --new-kid 2 --apply    # re-encrypt
//   ... --new-key <base64>   # supply the new key instead of minting one
//
// HONEST LIMIT (printed): rotation only bounds FUTURE epochs. It cannot claw back already-distributed
// plaintext or the OLD ciphertext that remains in git history and on the CDN. After rotation, keep the old
// key in the Worker's MEMBER_CONTENT_KEYS during the overlap window so old links still decrypt, then retire it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptAsset, encryptAsset, generateEpochKey } from '../client/src/crypto-assets.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

/** Re-encrypt one envelope under a new key + kid, preserving the asset id (AAD). Pure; unit-tested. */
export async function reencryptEnvelope(envelope, oldKey, newKey, newKid) {
  const plaintext = await decryptAsset({ envelope, key: oldKey }); // throws AssetAccessError if oldKey is wrong
  return encryptAsset({ plaintext, key: newKey, assetId: envelope.aad, kid: String(newKid) });
}

/**
 * Phase 1 of rotation: re-encrypt EVERY item in memory. Pure (no I/O), so the all-or-nothing semantics are
 * unit-testable. items: [{ id, envelope }]. Returns { planned: [{id, envelope}], failed: [{id, reason}] }.
 * The caller writes ONLY when failed is empty, so a wrong/partial old key never yields a half-rotated tree.
 */
export async function planReencrypt(items, oldKey, newKey, newKid) {
  const planned = [];
  const failed = [];
  for (const it of items) {
    try {
      planned.push({ id: it.id, envelope: await reencryptEnvelope(it.envelope, oldKey, newKey, newKid) });
    } catch (e) {
      failed.push({ id: it.id, reason: e?.name || 'error' });
    }
  }
  return { planned, failed };
}

function* walkEnc(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkEnc(p);
    else if (p.endsWith('.enc')) yield p;
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const newKid = arg('--new-kid');
  const oldKey = process.env.MEMBER_CONTENT_KEY || arg('--old-key');
  // The new key may be supplied (CI: MEMBER_CONTENT_KEY_NEW or --new-key) or minted locally. When it is
  // supplied (the operator already holds it), --no-print-key suppresses echoing it so it never lands in CI logs.
  const suppliedNewKey = arg('--new-key') || process.env.MEMBER_CONTENT_KEY_NEW || null;
  const newKey = suppliedNewKey || generateEpochKey();
  const printKey = !process.argv.includes('--no-print-key') && !suppliedNewKey;

  if (!newKid) { console.error('rotate: --new-kid <id> is required (the new epoch id).'); process.exit(1); }
  if (!oldKey) { console.error('rotate: the OLD key is required via MEMBER_CONTENT_KEY env or --old-key.'); process.exit(1); }

  const files = [...walkEnc(path.join(ROOT, 'house')), ...walkEnc(path.join(ROOT, 'members'))];
  console.log(`rotate: found ${files.length} encrypted asset(s) to re-encrypt to epoch ${newKid}.`);

  // Phase 1: re-encrypt EVERY asset in memory. If ANY asset fails (a wrong/partial old key throws, or an
  // unreadable envelope), abort with NO writes, so --apply never leaves a half-rotated, mixed-epoch tree.
  const items = [];
  const failed = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    try { items.push({ id: f, rel, envelope: JSON.parse(fs.readFileSync(f, 'utf8')) }); }
    catch { failed.push(rel + ' (unreadable envelope)'); }
  }
  const plan = await planReencrypt(items, oldKey, newKey, newKid);
  const relOf = (id) => items.find((i) => i.id === id)?.rel || id;
  for (const x of plan.failed) failed.push(relOf(x.id) + ' (' + x.reason + ')');

  if (failed.length) {
    console.error(`rotate: ABORTED, ${failed.length}/${files.length} asset(s) could not be re-encrypted. NO files were written (the old key may be wrong, or an envelope is on a different epoch):`);
    for (const x of failed) console.error('  - ' + x);
    process.exitCode = 1;
    return;
  }

  // Phase 2: only reached when the FULL set re-encrypted cleanly. Now write atomically (all or nothing above).
  if (apply) for (const p of plan.planned) fs.writeFileSync(p.id, JSON.stringify(p.envelope));
  console.log(`rotate: ${apply ? 'RE-ENCRYPTED' : 'WOULD re-encrypt'} ${plan.planned.length}/${files.length} asset(s) to epoch ${newKid}.`);

  if (!apply) {
    console.log('\nrotate: DRY RUN, nothing written. Re-run with --apply to write and mint the new key (or pass --new-key for a fixed one).');
    return;
  }
  console.log('\nNext steps for the operator:');
  console.log('  1. wrangler secret put MEMBER_CONTENT_KEY   # set it to the NEW epoch key');
  console.log('  2. set wrangler.toml [vars] MEMBER_CONTENT_KID = "' + newKid + '"');
  console.log('  3. brief overlap only: set MEMBER_CONTENT_KEYS so the OLD epoch still decrypts during CDN');
  console.log('     propagation, then REMOVE it (destroy the old key) so the old git-history ciphertext is keyless.');
  if (printKey) console.log('\n  NEW MEMBER_CONTENT_KEY (base64, epoch ' + newKid + '):\n  ' + newKey);
  else console.log('\n  (the new key was supplied via env/--new-key and is not echoed here)');
  console.log('\n  Honest limit: the OLD ciphertext stays in git history + on the CDN; rotation protects only future content.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('rotate: failed:', err?.message ?? err); process.exit(1); });
}
