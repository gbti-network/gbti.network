#!/usr/bin/env node
// Build guard (launch hardening): every destination in public/_redirects must resolve to a real page in dist,
// so a 301 never lands on a 404. This is what catches a content visibility change (a post going Mode A, a slug
// rename, a draft) that would otherwise turn a legacy URL into a broken redirect and lose the SEO equity.
// `scripts/gen-redirects.mjs` already retargets such destinations to /membership/; this guard is the backstop
// that fails the build if the generator was not re-run after a content change.
//   node scripts/check-redirects.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve a root-relative destination path to the dist file Cloudflare Pages would serve. Returns the candidate
 * paths checked (absolute), so the caller can assert at least one exists.
 */
export function candidatesFor(distDir, dest) {
  // Strip a query/hash if any (our generated redirects have none, but be defensive).
  const clean = dest.replace(/[?#].*$/, '');
  const rel = clean.replace(/^\/+/, ''); // drop the leading slash for path.join
  if (clean.endsWith('/')) return [path.join(distDir, rel, 'index.html')];
  if (path.extname(clean)) return [path.join(distDir, rel)]; // has a file extension, serve verbatim
  // No trailing slash and no extension: Pages would serve <path>/index.html or <path>.html.
  return [path.join(distDir, rel, 'index.html'), path.join(distDir, rel + '.html')];
}

/**
 * Check that every destination in public/_redirects resolves to a file in dist. Pure over root/distDir, so it is
 * unit-testable. External (http/https) and wildcard (`*`/`:`) destinations are skipped (with a note). Returns
 * { errors, notes, checked }.
 */
export function checkRedirects({ root, distDir = path.join(root, 'dist'), redirectsFile = path.join(root, 'public/_redirects') } = {}) {
  const errors = [];
  const notes = [];
  let checked = 0;

  if (!fs.existsSync(redirectsFile)) {
    notes.push('public/_redirects not found, nothing to check (run scripts/gen-redirects.mjs).');
    return { errors, notes, checked };
  }
  if (!fs.existsSync(distDir)) {
    notes.push('dist/ not found, skipped the redirect-resolution check (run after `npm run build`).');
    return { errors, notes, checked };
  }

  const rows = fs.readFileSync(redirectsFile, 'utf8').split('\n');
  for (const raw of rows) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [source, dest] = line.split(/\s+/);
    if (!source || !dest) continue;
    if (/^https?:\/\//i.test(dest)) { notes.push(`external destination skipped: ${dest}`); continue; }
    if (dest.includes('*') || dest.includes(':')) { notes.push(`wildcard destination skipped: ${source} -> ${dest}`); continue; }
    if (!dest.startsWith('/')) { errors.push(`destination is not root-relative: ${source} -> ${dest}`); continue; }
    checked++;
    const candidates = candidatesFor(distDir, dest);
    if (!candidates.some((c) => fs.existsSync(c))) {
      errors.push(`redirect destination does not resolve in dist: ${source} -> ${dest} (no ${candidates.map((c) => path.relative(distDir, c)).join(' or ')}). Re-run scripts/gen-redirects.mjs.`);
    }
  }
  return { errors, notes, checked };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, notes, checked } = checkRedirects({ root: ROOT });
  for (const n of notes) console.log('· ' + n);
  if (errors.length) {
    console.error(`✗ redirects guard failed (${errors.length} unresolved of ${checked} checked):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ redirects guard passed (${checked} destination${checked === 1 ? '' : 's'} resolve in dist)`);
}
