#!/usr/bin/env node
// Standalone, frequent overrides-mirror sync (SOW-005 / SOW-015 reliability hardening).
//
// The signup Worker applies effective status (ban > staff > grandfather > Stripe) SERVER-SIDE from a KV blob,
// `overrides:mirror`, and FAILS CLOSED once that blob is older than 48h (MAX_OVERRIDES_AGE_MS) — denying every
// effective-paid member (including superadmins) until it is refreshed. The daily reconcile (`scripts/reconcile.mjs
// --apply`) writes the mirror, but only near the END of a large job, so an unrelated earlier failure (a content
// flip, a Discord hiccup, a Stripe blip) aborts the run BEFORE the mirror write and the blob ages out. This job
// does ONLY the mirror write — read the three `house/` override files, build the blob, one KV PUT — so the
// gating can never be starved by an unrelated reconcile failure. Run it on a tight cron (every 6h) independent
// of the reconcile.
//
//   node scripts/sync-overrides-mirror.mjs            # write (needs CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN)
//   node scripts/sync-overrides-mirror.mjs --dry-run  # report what it would write, touch nothing

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { loadOverridesRaw } from '../membership/overrides.mjs';
import { buildOverridesMirror, mirrorOverridesToKv, mirrorSyndicationConfigToKv, mirrorCouponsToKv, gitOwnedSections, loadCouponsRaw, mirrorDigestConfigToKv } from './lib/kv-mirror.mjs';
import { toSyndicationMirror } from '../membership/syndication-config.mjs';
import { toCouponsMirror } from '../membership/coupons.mjs';

/**
 * Build the overrides mirror from the repo's house/ files and write it to KV. Pure over its injected deps
 * (root, env, fetchImpl, now), so it is unit-tested with a fake fetch + env. Returns the mirrorOverridesToKv
 * result ({ written, key, bytes, reason }), or a dry-run report.
 */
export async function syncOverridesMirror({ root, env = process.env, fetchImpl, now = new Date(), dryRun = false } = {}) {
  const raw = loadOverridesRaw(root);
  // sow-213 Phase 3: a section whose git file is GONE is preserved from KV, never rebuilt from an empty read.
  // Derived from the checkout so the flip needs no flag change; see kv-mirror.sectionFor for why.
  const ownedByGit = gitOwnedSections(root);
  if (dryRun) {
    // The dry run reports on the git-owned shape only. It cannot read KV, so it must not pretend to know what a
    // preserved section holds; passing the REALITY-DERIVED `ownedByGit` here would make it throw on the very
    // state it is reporting (git-not-owned + no `existing` to preserve = abort). sow-213 R9: `ownedByGit` is now
    // required, so pass EXPLICIT git-owned, which reports the git shape and never throws (empty once the files
    // are gone). The write path below uses the reality-derived `ownedByGit`.
    const blob = buildOverridesMirror(raw, now, null, { bans: true, grandfathered: true });
    return { dryRun: true, bytes: JSON.stringify(blob).length, roles: Object.keys(blob.roles ?? {}).length, generatedAt: blob.generatedAt, ownedByGit };
  }
  return mirrorOverridesToKv({ raw, env, now, ownedByGit, ...(fetchImpl ? { fetchImpl } : {}) });
}

/**
 * SOW-058: mirror house/syndication-config.yml -> KV synd:config so the Worker drain reads the live channel
 * switches, require_approval, hold, and threshold. Stripe-free (only CF creds), so it rides this lightweight job
 * (and its 6h cron) instead of forcing a full reconcile to enable/adjust syndication.
 */
export async function syncSyndicationConfigMirror({ root, env = process.env, fetchImpl, dryRun = false } = {}) {
  let raw = {};
  try { raw = yaml.load(fs.readFileSync(path.join(root, 'house', 'syndication-config.yml'), 'utf8')) || {}; } catch { raw = {}; }
  if (dryRun) {
    const m = toSyndicationMirror(raw);
    return { dryRun: true, enabled: m.enabled, require_approval: m.require_approval, channels: m.channels };
  }
  return mirrorSyndicationConfigToKv({ raw, env, ...(fetchImpl ? { fetchImpl } : {}) });
}

/**
 * sow-266: mirror house/digest-config.yml -> KV digest:config, so the mail compile reads the owner's pitch
 * copy and sponsor slot live. Rides this job as well as the daily reconcile.
 *
 * sow-270 CORRECTION. This used to say the digest manager calls the sync straight after a save. It never did:
 * the manager saves by opening a pull request, and the only caller of the immediate refresh is a role change.
 * A digest save therefore waited up to six hours, which is wrong for a setting deciding what a stranger
 * consented to. The fix is a push trigger on the workflow rather than a call from the save, because the save
 * happens BEFORE the merge and a refresh fired then reads the pre-merge file. See the trigger's own comment in
 * .github/workflows/sync-overrides-mirror.yml.
 *
 * An unreadable file returns WITHOUT writing, rather than mirroring an empty blob. Empty would revert the
 * owner's copy to the compiled default, silently, on a green run.
 */
export async function syncDigestConfigMirror({ root, env = process.env, fetchImpl, dryRun = false } = {}) {
  let raw = null;
  try { raw = yaml.load(fs.readFileSync(path.join(root, 'house', 'digest-config.yml'), 'utf8')); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return { written: false, key: 'digest:config', bytes: 0, reason: 'house/digest-config.yml missing or unreadable' };
  if (dryRun) return { dryRun: true, cta: !!raw.cta, sponsorEnabled: raw?.sponsor?.enabled === true };
  return mirrorDigestConfigToKv({ raw, env, ...(fetchImpl ? { fetchImpl } : {}) });
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    // 1) overrides:mirror — the effective-paid gate; must stay fresh (the original purpose of this job).
    try {
      const r = await syncOverridesMirror({ root: ROOT, dryRun });
      if (r.dryRun) console.log(`sync-mirror: DRY RUN would write overrides:mirror (${r.bytes} bytes, ${r.roles} role section${r.roles === 1 ? '' : 's'}, generatedAt ${r.generatedAt}).`);
      else if (r.written) console.log(`sync-mirror: wrote overrides:mirror (${r.bytes} bytes).`);
      // A SKIP means the CF credentials are missing/incomplete — the silent-no-op that let the mirror go stale.
      // Fail LOUD so a misconfigured run is noticed (a red Action) instead of quietly starving the gate.
      else { console.error(`sync-mirror: overrides:mirror NOT written (${r.reason}). Set CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN.`); process.exitCode = 1; }
    } catch (e) { console.error('sync-mirror: overrides:mirror FAILED:', e?.message ?? e); process.exitCode = 1; }

    // 2) synd:config — SOW-058: the drain reads this for the enable flag, channels, approval, and hold.
    try {
      const s = await syncSyndicationConfigMirror({ root: ROOT, dryRun });
      if (s.dryRun) console.log(`sync-mirror: DRY RUN would write synd:config (enabled=${s.enabled}, require_approval=${s.require_approval}).`);
      else if (s.written) console.log(`sync-mirror: wrote synd:config (${s.bytes} bytes).`);
      else { console.error(`sync-mirror: synd:config NOT written (${s.reason}).`); process.exitCode = 1; }
    } catch (e) { console.error('sync-mirror: synd:config FAILED:', e?.message ?? e); process.exitCode = 1; }

    // 3) coupons:config — SOW-119: signup validates coupon codes against this, so a coupon edit
    // (create, deactivate, freeDays change) goes live at the next tick without a redeploy.
    try {
      // sow-291 Phase 2: ABSENT and UNPARSEABLE are different states, and the old `catch { {} }` collapsed
      // them into the one that erases the registry. loadCouponsRaw throws on unreadable and reports absence.
      const { raw: rawCoupons, ownedByGit } = loadCouponsRaw(ROOT);
      if (dryRun) {
        // Like the overrides dry run, this reports the GIT-owned shape only: it cannot read KV, so it must not
        // pretend to know what a preserved registry holds, and passing ownership would make it throw on the
        // very state it is reporting.
        const m = toCouponsMirror(rawCoupons, new Date(), null, true); // sow-291 R9: ownedByGit is now required; the dry run reports the git-owned shape only (it cannot read KV)
        console.log(`sync-mirror: DRY RUN would write coupons:config (${m.coupons.length} coupon${m.coupons.length === 1 ? '' : 's'}, git-owned=${ownedByGit}).`);
      } else {
        const c = await mirrorCouponsToKv({ raw: rawCoupons, ownedByGit });
        if (c.written) console.log(`sync-mirror: wrote coupons:config (${c.bytes} bytes).`);
        else { console.error(`sync-mirror: coupons:config NOT written (${c.reason}).`); process.exitCode = 1; }
      }
    } catch (e) { console.error('sync-mirror: coupons:config FAILED:', e?.message ?? e); process.exitCode = 1; }

    // 4) digest:config - sow-266: the digest's pitch copy and sponsor slot, plus the sow-270 confirmation
    // switch, so an edit from the manager is live within about a minute of its pull request merging rather
    // than at the next daily reconcile.
    try {
      const d = await syncDigestConfigMirror({ root: ROOT, dryRun });
      if (d.dryRun) console.log(`sync-mirror: DRY RUN would write digest:config (cta=${d.cta}, sponsor enabled=${d.sponsorEnabled}).`);
      else if (d.written) console.log(`sync-mirror: wrote digest:config (${d.bytes} bytes).`);
      else { console.error(`sync-mirror: digest:config NOT written (${d.reason}).`); process.exitCode = 1; }
    } catch (e) { console.error('sync-mirror: digest:config FAILED:', e?.message ?? e); process.exitCode = 1; }
  })();
}
