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
import { WEB_STORE_URL } from '../src/lib/extension-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pure check: given the manifest, the parsed latest.json, and the raw zip bytes, return a list of problems
 *  (empty = consistent). Kept dependency-light + filesystem-free so it is unit-testable with fixtures. */
export function checkExtension({ manifest, latest, zipBuf, zipName = 'gbti-network-extension.zip', webStoreUrl = WEB_STORE_URL }) {
  const errors = [];
  if (!latest || typeof latest !== 'object') return ['public/extension/latest.json is missing or not an object'];
  if (latest.version !== manifest.version) errors.push(`latest.json version ${JSON.stringify(latest.version)} != manifest version ${JSON.stringify(manifest.version)}`);
  if (latest.name !== manifest.name) errors.push(`latest.json name ${JSON.stringify(latest.name)} != manifest name ${JSON.stringify(manifest.name)}`);
  if (latest.zip !== `/extension/${zipName}`) errors.push(`latest.json zip ${JSON.stringify(latest.zip)} != /extension/${zipName}`);
  // sow-244: the store link has one source (src/lib/extension-store.mjs). It sat empty here for two months because
  // the packager hardcoded '' and this guard never looked at the field.
  if (!webStoreUrl || latest.webStoreUrl !== webStoreUrl) errors.push(`latest.json webStoreUrl ${JSON.stringify(latest.webStoreUrl)} != the store listing ${JSON.stringify(webStoreUrl)} (run npm run build:extension)`);

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

/**
 * sow-244: no built page may offer the retired unpacked install, and only the MCP guide may link the package zip
 * (it carries the MCP server; loading it into Chrome is not a supported install). `pages` maps a dist-relative
 * path to its HTML. Returns a list of problems; a page that is absent is reported, so a renamed page cannot make
 * this pass on nothing.
 */
export const UNPACKED_OFFER = /Load unpacked|Developer mode|unpacked (extension|install|ZIP)|chrome:\/\/extensions/i;
export const ZIP_HREF = /href="\/extension\/gbti-network-extension\.zip"/;
export const NO_UNPACKED_PAGES = ['extension/index.html'];
export const ZIP_ALLOWED_PAGE = 'workbench/mcp/index.html';

export function checkInstallSurfaces(pages) {
  const errors = [];
  const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ').replace(/<[^>]+>/g, ' ');
  for (const rel of NO_UNPACKED_PAGES) {
    if (!(rel in pages)) { errors.push(`${rel} was not built, so the unpacked-offer check had nothing to read`); continue; }
    const m = UNPACKED_OFFER.exec(text(pages[rel]));
    if (m) errors.push(`${rel} offers the retired unpacked install ("${m[0]}"). The Chrome Web Store is the only supported install (sow-244).`);
  }
  for (const [rel, html] of Object.entries(pages)) {
    if (rel !== ZIP_ALLOWED_PAGE && ZIP_HREF.test(html)) errors.push(`${rel} links the extension package zip; only the MCP guide (${ZIP_ALLOWED_PAGE}) may (sow-244).`);
  }
  if (!(ZIP_ALLOWED_PAGE in pages)) errors.push(`${ZIP_ALLOWED_PAGE} was not built`);
  return errors;
}

function builtHtmlPages(distDir) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out[path.relative(distDir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(distDir);
  return out;
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
  const distDir = path.join(ROOT, 'dist');
  let surfaces = 'no dist, install pages not checked';
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    const pageErrors = checkInstallSurfaces(builtHtmlPages(distDir));
    if (pageErrors.length) {
      console.error('check:extension FAILED (a page offers the retired unpacked install):');
      for (const e of pageErrors) console.error(`  - ${e}`);
      process.exit(1);
    }
    surfaces = 'store-only install pages';
  }
  const fileCount = readZipEntries(zipBuf).length;
  console.log(`✓ extension distribution guard passed (v${latest.version}, ${(zipBuf.length / 1024).toFixed(0)} KB, ${fileCount} files, latest.json consistent, ${surfaces})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
