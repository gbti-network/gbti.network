// sow-348: the extension download (public/extension/gbti-network-extension.zip + latest.json) is BUILT, never
// committed. A committed copy added about 3 MB to the repository on every client change, and it was never the copy
// served: the deploy's `npm run build:pages` packages its own first. These pin the move and the two scans that now
// cover the download where it is built, since the commit-time secret scan can no longer see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { packageExtension, readZipEntries, zip } from '../extension/package.mjs';
import { checkExtension, checkServedCopies } from '../scripts/check-extension.mjs';
import { checkBuildSecrets } from '../scripts/check-build-secrets.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MANIFEST = JSON.parse(read('extension/manifest.json'));
const PKG = packageExtension({ write: false });
const LATEST = { version: PKG.version, name: PKG.name, zip: PKG.zip, webStoreUrl: PKG.webStoreUrl, bytes: PKG.buf.length, mcp: PKG.mcp };
const FAKE_SLACK = 'xox' + 'b-000000000000-000000000000-' + 'A'.repeat(24); // split so this file is not itself a finding
const withBackground = (text) => zip(readZipEntries(PKG.buf).map((e) => (e.name === 'dist/background.js' ? { name: e.name, data: Buffer.from(text) } : e)));

// ---- the files are untracked, and nothing still expects them in git ----

test('both generated files are ignored and untracked, and every surface that used to commit them agrees', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^public\/extension\/gbti-network-extension\.zip$/m);
  assert.match(ignore, /^public\/extension\/latest\.json$/m);
  assert.equal(execFileSync('git', ['ls-files', '--', 'public/extension'], { cwd: ROOT, encoding: 'utf8' }).trim(), '', 'nothing under public/extension is tracked');
  const drift = read('.github/workflows/extension-check.yml');
  assert.match(drift, /run: git diff --exit-code -- client-ui\/dist extension\/dist extension\/mcp\n/, 'the drift diff names the three committed outputs');
  assert.doesNotMatch(drift, /git diff[^\n]*public\/extension/, 'an untracked path in a diff passes on nothing');
  assert.match(drift, /- run: npm run build:extension[\s\S]*- run: npm run check:extension/, 'the fresh build is still checked');
  const release = read('scripts/release.mjs');
  assert.match(release, /git add extension\/manifest\.json src\/lib\/extension\.ts\\n/);
  assert.doesNotMatch(release, /git add[^\n]*public\/extension/);
  assert.match(read('package.json'), /"build:pages": "npm run build:extension && astro build/, 'the deploy still packages the download before the site build');
  assert.match(read('.github/workflows/publish-extension.yml'), /run: npm run build:extension && node scripts\/check-extension\.mjs/, 'the store workflow builds its own');
});

// ---- the distribution check scans what it checks, and checks what is served ----

test('a fresh package passes the distribution check, and a credential inside any file fails it', () => {
  assert.deepEqual(checkExtension({ manifest: MANIFEST, latest: LATEST, zipBuf: PKG.buf }), []);
  const planted = withBackground(`const t='${FAKE_SLACK}';`);
  const errors = checkExtension({ manifest: MANIFEST, latest: { ...LATEST, bytes: planted.length }, zipBuf: planted });
  assert.equal(errors.length, 1, errors.join(' | '));
  assert.match(errors[0], /the served zip carries a possible credential: .*inside dist\/background\.js/);
});

test('an empty archive still fails, so the scan cannot pass on nothing', () => {
  const empty = zip([]);
  const errors = checkExtension({ manifest: MANIFEST, latest: { ...LATEST, bytes: empty.length }, zipBuf: empty });
  assert.ok(errors.some((e) => /missing manifest\.json/.test(e)), errors.join(' | '));
});

test('the served copy must be the checked copy', () => {
  const text = JSON.stringify(LATEST);
  assert.deepEqual(checkServedCopies({ zipBuf: PKG.buf, latestText: text, servedZip: Buffer.from(PKG.buf), servedLatest: text }), []);
  assert.match(checkServedCopies({ zipBuf: PKG.buf, latestText: text, servedZip: null, servedLatest: text }).join(), /serves no download/);
  assert.match(checkServedCopies({ zipBuf: PKG.buf, latestText: text, servedZip: withBackground('x'), servedLatest: text }).join(), /zip differs/);
  assert.match(checkServedCopies({ zipBuf: PKG.buf, latestText: text, servedZip: PKG.buf, servedLatest: null }).join(), /latest\.json is missing/);
  assert.match(checkServedCopies({ zipBuf: PKG.buf, latestText: text, servedZip: PKG.buf, servedLatest: `${text} ` }).join(), /latest\.json differs/);
  const src = read('scripts/check-extension.mjs');
  assert.match(src, /\.\.\.checkServedCopies\(\{ zipBuf, latestText, servedZip: readOrNull\(path\.join\(distDir, 'extension\/gbti-network-extension\.zip'\)\)/, 'the built site is compared, whenever there is one');
});

// ---- the deploy scan opens the download ----

function distWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-dl-'));
  fs.mkdirSync(path.join(root, 'dist/extension'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<html>ok</html>');
  for (const [rel, buf] of Object.entries(files)) fs.writeFileSync(path.join(root, 'dist', rel), buf);
  return root;
}
const KEY = 'k'.repeat(12) + 'SECRETVALUE';
const keyErrors = (r) => r.errors.filter((e) => /archive|leaked|inlined/.test(e));

test('the deploy scan finds the member-content key inside the download, where the deploy-built bundles live', () => {
  const clean = distWith({ 'extension/gbti-network-extension.zip': PKG.buf });
  assert.deepEqual(keyErrors(checkBuildSecrets({ root: clean, env: { MEMBER_CONTENT_KEY: KEY } })), []);
  const leaked = distWith({ 'extension/gbti-network-extension.zip': withBackground(`const k="${KEY}";`) });
  const errors = keyErrors(checkBuildSecrets({ root: leaked, env: { MEMBER_CONTENT_KEY: KEY } }));
  assert.equal(errors.length, 1, errors.join(' | '));
  assert.match(errors[0], /leaked MEMBER_CONTENT_KEY value in build output: dist\/extension\/gbti-network-extension\.zip \(inside it: dist\/background\.js\)/);
  const inlined = distWith({ 'extension/gbti-network-extension.zip': withBackground(`MEMBER_CONTENT_KEY = "${'A'.repeat(32)}"`) });
  assert.match(keyErrors(checkBuildSecrets({ root: inlined, env: {} })).join(), /inlined MEMBER_CONTENT_KEY assignment appears in: .*inside it: dist\/background\.js/);
  for (const r of [clean, leaked, inlined]) fs.rmSync(r, { recursive: true, force: true });
});

test('an archive the deploy scan cannot open, or one holding nothing, is an error rather than a skip', () => {
  const junk = distWith({ 'extension/gbti-network-extension.zip': Buffer.from('not a zip') });
  assert.match(keyErrors(checkBuildSecrets({ root: junk, env: {} })).join(), /could not open the archive dist\/extension\/gbti-network-extension\.zip/);
  const empty = distWith({ 'extension/gbti-network-extension.zip': zip([]) });
  assert.match(keyErrors(checkBuildSecrets({ root: empty, env: {} })).join(), /holds no files/);
  for (const r of [junk, empty]) fs.rmSync(r, { recursive: true, force: true });
});
