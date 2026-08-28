#!/usr/bin/env node
// Stamp an UNPACKED extension copy with the commit it was built from, so a stale install is visible in
// chrome://extensions instead of only in someone's memory.
//
// Why this exists: on 2026-08-27 the owner loaded the unpacked extension from the shared working clone, which
// runs ~147 commits behind origin/main. Its bundles were built from that stale source, so the Social Queue
// drew a "Post now to Reddit" button for a channel that had been manual for a day, and the Reddit body block
// was missing. Both trees reported version "0.3.0", so nothing anywhere on screen distinguished a current
// build from a very old one. The drift was invisible at exactly the moment it mattered.
//
// Why it stamps the COPY and not the source: `extension/manifest.json` is tracked, and the packaged zip under
// public/extension is compared by the extension-check drift job with `git diff --exit-code`. A manifest field
// derived from HEAD would therefore change every commit, and committing that change moves HEAD again, so the
// tree could never be clean. Staleness is a property of the INSTALLED copy, not of the repository, and this
// script keeps it there. No tracked file is written.
//
// Chrome renders `version_name` in place of `version` on the extensions page, so the stamp lands exactly where
// the folder is loaded, with no UI work and no runtime cost.
//
//   node scripts/stamp-extension-copy.mjs <dest-dir>
//
// Run it after copying a freshly built extension/ into <dest-dir>.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Build the `version_name` string. Pure, so the interesting part is testable without a git repo or a copy on
 * disk. A clean build at origin gets the bare sha; anything else says WHY it is not trustworthy, because
 * "0.3.0+49a487cc" alone reads as authoritative and the whole point is to stop that.
 */
export function stampFor({ version, sha, behind = 0, dirty = false } = {}) {
  const v = String(version || '0.0.0');
  if (!sha) return v; // no git (a tarball build): a plain version beats a lie about provenance
  let s = `${v}+${sha}`;
  if (behind > 0) s += ` BEHIND-ORIGIN-BY-${behind}`;
  if (dirty) s += ' DIRTY';
  return s;
}

/** Read the git facts, or nulls when git is unavailable or this is not a repo. Never throws. */
export function gitFacts(cwd) {
  const run = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let sha = null; let behind = 0; let dirty = false;
  try { sha = run(['rev-parse', '--short', 'HEAD']); } catch { return { sha: null, behind: 0, dirty: false }; }
  // How far this build is behind the branch everything actually deploys from. A count, not a boolean, because
  // "behind by 3" and "behind by 147" are different problems and only one of them explains a missing feature.
  try { behind = Number(run(['rev-list', '--count', 'HEAD..origin/main'])) || 0; } catch { behind = 0; }
  try { dirty = run(['status', '--porcelain', '--', 'extension', 'client-ui']).length > 0; } catch { dirty = false; }
  return { sha, behind, dirty };
}

export function stampCopy(dest, { cwd = process.cwd(), now = new Date() } = {}) {
  const manifestPath = path.join(dest, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`no manifest.json in ${dest}; is that an unpacked extension?`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { sha, behind, dirty } = gitFacts(cwd);
  const version_name = stampFor({ version: manifest.version, sha, behind, dirty });
  // Insert version_name directly after version so a human reading the file sees the pair together.
  const out = {};
  for (const [k, v] of Object.entries(manifest)) {
    out[k] = v;
    if (k === 'version') out.version_name = version_name;
  }
  if (!out.version_name) out.version_name = version_name; // manifest with no `version` key: still stamp it
  fs.writeFileSync(manifestPath, `${JSON.stringify(out, null, 2)}\n`);
  fs.writeFileSync(path.join(dest, 'BUILT-FROM-COMMIT.txt'),
    `${sha ?? 'unknown'}\nstamped ${now.toISOString()}\nbehind origin/main by ${behind}\ndirty: ${dirty}\n`);
  return { version_name, sha, behind, dirty };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const dest = process.argv[2];
  if (!dest) { console.error('usage: node scripts/stamp-extension-copy.mjs <dest-dir>'); process.exit(2); }
  const r = stampCopy(dest);
  console.log(`stamped ${dest}: version_name = ${r.version_name}`);
  if (r.behind > 0) console.log(`  WARNING: this build is ${r.behind} commits behind origin/main.`);
  if (r.dirty) console.log('  WARNING: extension/client-ui sources were modified but not committed.');
}
