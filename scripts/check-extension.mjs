// SOW-019: drift guard for the distributed Chrome extension. The site serves a committed
// public/extension/gbti-network-extension.zip + latest.json that must stay consistent with extension/manifest.json
// and must be a structurally valid archive carrying the full loadable file set. This is the cheap, read-only
// backstop (no rebuild) wired into `npm run verify:dist`; the deploy command rebuilds the zip first (always
// fresh in production), and the extension-check CI workflow rebuilds + diffs to catch a stale committed zip.
// What this guard catches without a rebuild: a manifest/version bump that was not repackaged, a truncated or
// corrupt zip, a latest.json that disagrees with the manifest or the real zip bytes, an incomplete build.
//   node scripts/check-extension.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZipEntries, requiredFiles } from '../extension/package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pure check: given the manifest, the parsed latest.json, and the raw zip bytes, return a list of problems
 *  (empty = consistent). Kept dependency-light + filesystem-free so it is unit-testable with fixtures. */
export function checkExtension({ manifest, latest, zipBuf, zipName = 'gbti-network-extension.zip' }) {
  const errors = [];
  if (!latest || typeof latest !== 'object') return ['public/extension/latest.json is missing or not an object'];
  if (latest.version !== manifest.version) errors.push(`latest.json version ${JSON.stringify(latest.version)} != manifest version ${JSON.stringify(manifest.version)}`);
  if (latest.name !== manifest.name) errors.push(`latest.json name ${JSON.stringify(latest.name)} != manifest name ${JSON.stringify(manifest.name)}`);
  if (latest.zip !== `/extension/${zipName}`) errors.push(`latest.json zip ${JSON.stringify(latest.zip)} != /extension/${zipName}`);

  if (!zipBuf || !zipBuf.length) return [...errors, `the served zip is missing or empty`];
  if (typeof latest.bytes === 'number' && latest.bytes !== zipBuf.length) errors.push(`latest.json bytes ${latest.bytes} != actual zip size ${zipBuf.length}`);

  let entries;
  try {
    entries = readZipEntries(zipBuf);
  } catch (e) {
    return [...errors, `the served zip does not parse: ${e.message}`];
  }
  const names = new Set(entries.map((e) => e.name));
  // Every file the manifest declares (service worker, content scripts, popup, each chrome_url_overrides page)
  // and every <script src> in a packaged HTML page must be in the zip, so a manifest-declared resource that was
  // not packaged (e.g. the newtab override page or its bundle) is caught instead of shipping a broken extension.
  const htmlSources = Object.fromEntries(entries.filter((e) => e.name.endsWith('.html')).map((e) => [e.name, e.data.toString('utf8')]));
  for (const f of requiredFiles(manifest, htmlSources)) {
    if (!names.has(f)) errors.push(`the served zip is missing ${f} (declared by the manifest or referenced by a packaged page; run npm run build:extension)`);
  }

  // The manifest inside the zip must match the source manifest after JSON normalization (parse then re-stringify
  // both sides), so whitespace/formatting differences are ignored but a content or key-order change is caught
  // (e.g. "bumped manifest, forgot to repackage" even when the version field happened to match).
  const zipped = entries.find((e) => e.name === 'manifest.json');
  if (zipped) {
    const sourceManifest = Buffer.from(JSON.stringify(manifest));
    let zippedParsed;
    try { zippedParsed = JSON.parse(zipped.data.toString('utf8')); } catch { zippedParsed = null; }
    if (!zippedParsed || Buffer.from(JSON.stringify(zippedParsed)).compare(sourceManifest) !== 0) {
      errors.push('the manifest.json inside the served zip differs from extension/manifest.json (stale package: run npm run build:extension)');
    }
  }
  return errors;
}

function run() {
  const manifestPath = path.join(ROOT, 'extension/manifest.json');
  const latestPath = path.join(ROOT, 'public/extension/latest.json');
  const zipPath = path.join(ROOT, 'public/extension/gbti-network-extension.zip');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!fs.existsSync(latestPath)) {
    console.error('check:extension FAILED: public/extension/latest.json is missing. Run npm run build:extension.');
    process.exit(1);
  }
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const zipBuf = fs.existsSync(zipPath) ? fs.readFileSync(zipPath) : null;

  const errors = checkExtension({ manifest, latest, zipBuf });
  if (errors.length) {
    console.error('check:extension FAILED (the served extension artifacts are stale or inconsistent):');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('Fix: run `npm run build:extension` and commit public/extension/.');
    process.exit(1);
  }
  const fileCount = readZipEntries(zipBuf).length;
  console.log(`✓ extension distribution guard passed (v${latest.version}, ${(zipBuf.length / 1024).toFixed(0)} KB, ${fileCount} files, latest.json consistent)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
