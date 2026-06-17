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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOverridesRaw } from '../membership/overrides.mjs';
import { buildOverridesMirror, mirrorOverridesToKv } from './lib/kv-mirror.mjs';

/**
 * Build the overrides mirror from the repo's house/ files and write it to KV. Pure over its injected deps
 * (root, env, fetchImpl, now), so it is unit-tested with a fake fetch + env. Returns the mirrorOverridesToKv
 * result ({ written, key, bytes, reason }), or a dry-run report.
 */
export async function syncOverridesMirror({ root, env = process.env, fetchImpl, now = new Date(), dryRun = false } = {}) {
  const raw = loadOverridesRaw(root);
  const blob = buildOverridesMirror(raw, now);
  if (dryRun) {
    return { dryRun: true, bytes: JSON.stringify(blob).length, roles: Object.keys(blob.roles ?? {}).length, generatedAt: blob.generatedAt };
  }
  return mirrorOverridesToKv({ raw, env, now, ...(fetchImpl ? { fetchImpl } : {}) });
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const dryRun = process.argv.includes('--dry-run');
  syncOverridesMirror({ root: ROOT, dryRun })
    .then((r) => {
      if (r.dryRun) {
        console.log(`sync-mirror: DRY RUN would write overrides:mirror (${r.bytes} bytes, ${r.roles} role section${r.roles === 1 ? '' : 's'}, generatedAt ${r.generatedAt}).`);
        return;
      }
      if (r.written) {
        console.log(`sync-mirror: wrote overrides:mirror (${r.bytes} bytes).`);
        return;
      }
      // A SKIP means the CF credentials are missing/incomplete — the exact silent-no-op that let the mirror go
      // stale before. Fail LOUD so a misconfigured scheduled run is noticed (a red Action) instead of quietly
      // starving the gate.
      console.error(`sync-mirror: NOT written (${r.reason}). Set CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN.`);
      process.exitCode = 1;
    })
    .catch((e) => {
      console.error('sync-mirror: FAILED:', e?.message ?? e);
      process.exitCode = 1;
    });
}
