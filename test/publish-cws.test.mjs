// SOW-133: the Chrome Web Store publish flow (token exchange -> upload -> publish) with an injected fetch, and the
// clean skip when credentials are unset (so CI never hard-fails). sow-348: the package is no longer committed, so
// these tests package the real extension in memory, write it to a temp file, and point the script at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, compareVersions, zipManifestVersion, decidePublish, packageProblems, trackedExtensionFiles } from '../scripts/publish-cws.mjs';
import { packageExtension, readZipEntries, zip } from '../extension/package.mjs';

// sow-239/240: the guard compares the version INSIDE THE ZIP against what the store item holds, so the
// fixtures read a real package rather than hardcoding a number that goes stale at the next release.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = packageExtension({ write: false });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-cws-'));
const ZIP_FILE = path.join(TMP, 'gbti-network-extension.zip');
fs.writeFileSync(ZIP_FILE, PKG.buf);
const ZIP_VERSION = zipManifestVersion(PKG.buf);
const MANIFEST_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;
// Hermetic: the package's own entries count as tracked, so a stray file in a developer's checkout cannot red these.
const TRACKED = new Set(readZipEntries(PKG.buf).map((e) => `extension/${e.name}`));
const run = (opts) => main({ zipPath: ZIP_FILE, tracked: () => TRACKED, ...opts });
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const FAKE_SLACK = 'xox' + 'b-000000000000-000000000000-' + 'A'.repeat(24); // split so this file is not itself a finding
const ITEM_OLDER = [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, { ok: true, status: 200, json: async () => ({ crxVersion: '0.0.1' }) }];

const CREDS = { CWS_CLIENT_ID: 'id', CWS_CLIENT_SECRET: 'sec', CWS_REFRESH_TOKEN: 'ref' };
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts?.method });
    for (const [re, resp] of handlers) if (re.test(url)) return resp;
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

test('publish-cws skips cleanly (no network) when credentials are unset', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const r = await run({ env: {}, fetchImpl });
  assert.equal(r.skipped, true);
  assert.equal(calls.length, 0);
});

test('publish-cws --check exchanges the token and stops (no upload or publish)', async () => {
  const { fetchImpl, calls } = fakeFetch([[/oauth2\.googleapis/, json(200, { access_token: 'tok' })]]);
  const r = await run({ env: CREDS, fetchImpl, checkOnly: true });
  assert.equal(r.checked, true);
  assert.equal(calls.length, 1);
});

test('publish-cws uploads then publishes with a valid token', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    ITEM_OLDER,
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
    [/items\/[^/]+\/publish/, json(200, { status: ['OK'] })],
  ]);
  const r = await run({ env: CREDS, fetchImpl });
  assert.equal(r.published, true);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'PUT', 'POST']); // token, item version, upload, publish
});

test('publish-cws --upload-only uploads but does not publish', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    ITEM_OLDER,
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
  ]);
  const r = await run({ env: CREDS, fetchImpl, uploadOnly: true });
  assert.equal(r.uploaded, true);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'PUT']);
});

test('publish-cws throws a clear error on an upload failure', async () => {
  const { fetchImpl } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    ITEM_OLDER,
    [/upload\/chromewebstore/, json(200, { uploadState: 'FAILURE', itemError: [{ error_detail: 'bad zip' }] })],
  ]);
  await assert.rejects(() => run({ env: CREDS, fetchImpl }), /upload failed: bad zip/);
});

test('publish-cws throws when the OAuth token exchange fails', async () => {
  const { fetchImpl } = fakeFetch([[/oauth2\.googleapis/, json(400, { error: 'invalid_grant', error_description: 'expired' })]]);
  await assert.rejects(() => run({ env: CREDS, fetchImpl }), /token exchange failed/);
});

// sow-239. The expensive lesson: v0.2.0 sat on the store item while 83 commits landed under that unchanged
// number, so the next publish would have been rejected by Google with a message about versions rather than
// about the real problem. These assert our own tooling refuses FIRST, with a message that names the fix.
test('publish-cws REFUSES to upload a version the item already holds (sow-239)', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, json(200, { crxVersion: ZIP_VERSION })],
  ]);
  await assert.rejects(() => run({ env: CREDS, fetchImpl }), /already holds .* strictly greater version/s);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET'], 'it must refuse BEFORE spending the upload');
});

test('publish-cws refuses a LOWER version too, not just an equal one (sow-239)', async () => {
  const { fetchImpl } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, json(200, { crxVersion: '99.0.0' })],
  ]);
  await assert.rejects(() => run({ env: CREDS, fetchImpl }), /already holds 99\.0\.0/);
});

// FAILS OPEN on an unreadable item version: a read failure must never block a legitimate release.
test('publish-cws proceeds when the item version cannot be read (sow-239, fails open)', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, json(500, { error: { message: 'boom' } })],
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
    [/items\/[^/]+\/publish/, json(200, { status: ['OK'] })],
  ]);
  const r = await run({ env: CREDS, fetchImpl });
  assert.equal(r.published, true, 'an unreadable item version must not block the release');
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'PUT', 'POST']);
});

test('compareVersions orders X.Y.Z correctly', () => {
  assert.equal(compareVersions('0.3.0', '0.2.0'), 1);
  assert.equal(compareVersions('0.2.0', '0.3.0'), -1);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1, 'numeric, not lexicographic');
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

// sow-240. The guard used to read extension/manifest.json while uploadPackage sent the ZIP, so the two could
// diverge and a STALE package would ship under a fresh number. Reachable path, verified: release.mjs checks
// `--no-build` and `--publish` independently, so `npm run release -- minor --no-build --publish` bumps the
// manifest, skips the rebuild AND check-extension, then publishes.
test('the shipped version is read from the ZIP, which is what actually gets uploaded (sow-240)', () => {
  assert.match(ZIP_VERSION || '', /^\d+\.\d+\.\d+$/, 'a fresh package carries a real version');
  assert.equal(ZIP_VERSION, MANIFEST_VERSION, 'a fresh package carries the manifest it was built from');
  const old = zip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ version: '0.0.9' })) }]);
  assert.equal(zipManifestVersion(old), '0.0.9', 'the version comes from inside the zip, not from the working tree');
  assert.equal(zipManifestVersion(Buffer.from('not a zip')), null, 'an unreadable zip yields null rather than throwing');
});

// sow-240, the PURE gate. Every branch, no zip and no network, so each of these can genuinely fail.
test('decidePublish REFUSES a zip that disagrees with the manifest (the skipped-build case)', () => {
  const d = decidePublish({ zip: '0.2.0', manifest: '0.4.0', item: '0.1.0' });
  assert.equal(d.ok, false);
  assert.match(d.error, /package is 0\.2\.0 but extension\/manifest\.json is 0\.4\.0/);
  assert.match(d.error, /build was skipped/);
});

test('decidePublish REFUSES a version the item already holds, and a lower one', () => {
  assert.equal(decidePublish({ zip: '0.2.0', manifest: '0.2.0', item: '0.2.0' }).ok, false);
  assert.equal(decidePublish({ zip: '0.2.0', manifest: '0.2.0', item: '9.0.0' }).ok, false);
  assert.match(decidePublish({ zip: '0.2.0', manifest: '0.2.0', item: '0.2.0' }).error, /strictly greater/);
});

test('decidePublish PERMITS a strictly greater version', () => {
  const d = decidePublish({ zip: '0.3.0', manifest: '0.3.0', item: '0.2.0' });
  assert.equal(d.ok, true);
  assert.match(d.note, /item holds 0\.2\.0, shipping 0\.3\.0/);
});

test('decidePublish FAILS OPEN when the item version is unreadable, but NOT past the manifest check', () => {
  assert.equal(decidePublish({ zip: '0.3.0', manifest: '0.3.0', item: null }).ok, true, 'unreadable item must not block');
  assert.equal(decidePublish({ zip: null, manifest: '0.3.0', item: '0.2.0' }).ok, true, 'unreadable zip must not block');
  // ...but a KNOWN divergence still refuses even when the item is unreadable: the stale-build case is local.
  assert.equal(decidePublish({ zip: '0.2.0', manifest: '0.4.0', item: null }).ok, false,
    'a stale package is a local fact and does not need the store to confirm it');
});

// sow-348: the package is a local BUILD now, so a local upload refuses anything a clean build would not contain.
const withEntry = (name, text) => zip([...readZipEntries(PKG.buf), { name, data: Buffer.from(text) }]);
const writeZip = (buf) => { const f = path.join(TMP, `pkg-${Math.random().toString(36).slice(2)}.zip`); fs.writeFileSync(f, buf); return f; };

test('packageProblems: a clean package passes; an untracked file, a credential, an unreadable or empty archive, or no git refuses', () => {
  assert.deepEqual(packageProblems({ zipBuf: PKG.buf, tracked: TRACKED }), []);
  assert.match(packageProblems({ zipBuf: withEntry('dist/stray.js', 'console.log(1)'), tracked: TRACKED }).join('\n'), /dist\/stray\.js is in the package, but extension\/dist\/stray\.js is not a file git tracks/);
  const planted = packageProblems({ zipBuf: withEntry('dist/background.js', `const t='${FAKE_SLACK}';`), tracked: new Set([...TRACKED, 'extension/dist/background.js']) });
  assert.match(planted.join('\n'), /possible credential: .*inside dist\/background\.js/);
  assert.match(packageProblems({ zipBuf: Buffer.from('not a zip'), tracked: TRACKED }).join('\n'), /does not open/);
  assert.match(packageProblems({ zipBuf: zip([]), tracked: TRACKED }).join('\n'), /holds no files/);
  assert.match(packageProblems({ zipBuf: PKG.buf, tracked: null }).join('\n'), /git could not list/);
});

test('a local upload refuses a stray file BEFORE any network call, even without credentials', async () => {
  const { fetchImpl, calls } = fakeFetch([[/oauth2\.googleapis/, json(200, { access_token: 'tok' })]]);
  const zipPath = writeZip(withEntry('dist/stray.js', 'console.log(1)'));
  await assert.rejects(() => main({ env: CREDS, fetchImpl, zipPath, tracked: () => TRACKED }), /refusing to upload[\s\S]*dist\/stray\.js[\s\S]*Publish extension workflow/);
  await assert.rejects(() => main({ env: {}, fetchImpl, zipPath, tracked: () => TRACKED }), /refusing to upload/, 'no credentials is not a way around it');
  await assert.rejects(() => main({ env: CREDS, fetchImpl, zipPath: ZIP_FILE, tracked: () => null }), /git could not list/);
  await assert.rejects(() => main({ env: CREDS, fetchImpl, zipPath: path.join(TMP, 'absent.zip'), tracked: () => TRACKED }), /missing package/);
  assert.equal(calls.length, 0);
});

test('the real tracked-file lookup lists this checkout\'s extension files, and answers null outside a repository', () => {
  const tracked = trackedExtensionFiles(ROOT);
  assert.ok(tracked instanceof Set);
  for (const f of ['extension/manifest.json', 'extension/dist/background.js', 'extension/mcp/gbti-network-mcp.mjs']) assert.ok(tracked.has(f), f);
  assert.equal([...tracked].some((f) => !f.startsWith('extension/')), false);
  assert.equal(trackedExtensionFiles(fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-nogit-'))), null);
});
