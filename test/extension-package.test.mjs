// SOW-019: the dependency-free ZIP writer used to package the extension. Validates CRC32 against the standard
// IEEE test vector and that zip() emits a structurally valid archive (signatures + entry count + inflatable
// entries), so a regression in the hand-rolled zip cannot silently ship a corrupt download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32, zip, readZipEntries, requiredFiles } from '../extension/package.mjs';
import { checkExtension } from '../scripts/check-extension.mjs';

test('crc32 matches the standard IEEE vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('')), 0);
});

test('zip() emits a valid archive: local header, EOCD, entry count', () => {
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'dist/x.js', data: Buffer.from('console.log(1)') },
  ];
  const buf = zip(entries);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, 'starts with a local file header signature');
  const eocd = buf.subarray(buf.length - 22);
  assert.equal(eocd.readUInt32LE(0), 0x06054b50, 'ends with the end-of-central-directory record');
  assert.equal(eocd.readUInt16LE(10), entries.length, 'EOCD records the entry count');
});

test('zip() entries inflate back to the original bytes (deflate round-trip)', () => {
  const data = Buffer.from('hello '.repeat(100)); // compressible
  const buf = zip([{ name: 'a.txt', data }]);
  // The first local entry: 30-byte header + name, then the deflated payload (compSize at offset 18).
  const nameLen = buf.readUInt16LE(26);
  const compSize = buf.readUInt32LE(18);
  const start = 30 + nameLen;
  const comp = buf.subarray(start, start + compSize);
  const back = zlib.inflateRawSync(comp);
  assert.deepEqual(back, data);
  assert.equal(buf.readUInt32LE(14), crc32(data), 'local header CRC matches the data');
});

test('readZipEntries() round-trips zip(): names + bytes recovered via the central directory', () => {
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"version":"1.2.3"}') },
    { name: 'dist/background.js', data: Buffer.from('x'.repeat(500)) }, // compressible
    { name: 'popup.html', data: Buffer.from('<!doctype html><b>hi</b>') },
  ];
  const back = readZipEntries(zip(entries));
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name), 'names + order preserved');
  for (let i = 0; i < entries.length; i++) assert.deepEqual(back[i].data, entries[i].data, `entry ${i} bytes round-trip`);
});

// ---- the check:extension drift guard (pure core), driven by a realistic manifest + pages ----
const M = {
  version: '0.1.0',
  name: 'GBTI Network Extension',
  background: { service_worker: 'dist/background.js' },
  content_scripts: [{ js: ['dist/content.js'] }],
  action: { default_popup: 'popup.html' },
  chrome_url_overrides: { newtab: 'newtab.html' }, // SOW-017 newtab override (the file the old hand-list forgot)
};
// Each HTML page carries its <script src> so the guard can transitively require the bundle (newtab -> shares too).
const HTML = {
  'popup.html': '<!doctype html><script src="dist/popup.js"></script>',
  'newtab.html': '<!doctype html><a href="shares.html">shares</a><script src="dist/newtab.js"></script>',
  'shares.html': '<!doctype html><script src="dist/shares.js"></script>',
};
const BUNDLES = ['dist/background.js', 'dist/content.js', 'dist/popup.js', 'dist/newtab.js', 'dist/shares.js'];
const fileSet = (manifestObj = M) => [
  { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifestObj, null, 2)) },
  ...Object.entries(HTML).map(([n, h]) => ({ name: n, data: Buffer.from(h) })),
  ...BUNDLES.map((n) => ({ name: n, data: Buffer.from(`// ${n}`) })),
];
const fullZip = (manifestObj = M, drop = []) => zip(fileSet(manifestObj).filter((e) => !drop.includes(e.name)));
const latestFor = (zipBuf, manifestObj = M) => ({ version: manifestObj.version, name: manifestObj.name, zip: '/extension/gbti-network-extension.zip', bytes: zipBuf.length });

test('requiredFiles: derives the manifest refs + each page bundle (incl. the newtab override + dist/shares.js)', () => {
  const req = requiredFiles(M, HTML);
  for (const f of ['manifest.json', 'dist/background.js', 'dist/content.js', 'popup.html', 'dist/popup.js', 'newtab.html', 'dist/newtab.js', 'dist/shares.js']) {
    assert.ok(req.has(f), `requiredFiles should include ${f}`);
  }
});

test('checkExtension: a consistent zip + latest.json passes (no errors)', () => {
  const zipBuf = fullZip();
  assert.deepEqual(checkExtension({ manifest: M, latest: latestFor(zipBuf), zipBuf }), []);
});

test('checkExtension: a missing manifest-declared override page is caught', () => {
  const zipBuf = fullZip(M, ['newtab.html']); // the manifest still declares newtab; the page is not packaged
  const errors = checkExtension({ manifest: M, latest: latestFor(zipBuf), zipBuf });
  assert.ok(errors.some((e) => /newtab\.html/.test(e)), JSON.stringify(errors));
});

test('checkExtension: a page-referenced bundle missing from the zip is caught', () => {
  const zipBuf = fullZip(M, ['dist/newtab.js']); // newtab.html references it; the bundle is absent
  const errors = checkExtension({ manifest: M, latest: latestFor(zipBuf), zipBuf });
  assert.ok(errors.some((e) => /dist\/newtab\.js/.test(e)), JSON.stringify(errors));
});

test('checkExtension: a version skew between manifest and latest.json is caught', () => {
  const zipBuf = fullZip();
  const errors = checkExtension({ manifest: M, latest: { ...latestFor(zipBuf), version: '9.9.9' }, zipBuf });
  assert.ok(errors.some((e) => /version/.test(e)), JSON.stringify(errors));
});

test('checkExtension: a wrong bytes count in latest.json is caught', () => {
  const zipBuf = fullZip();
  const errors = checkExtension({ manifest: M, latest: { ...latestFor(zipBuf), bytes: 1 }, zipBuf });
  assert.ok(errors.some((e) => /bytes/.test(e)), JSON.stringify(errors));
});

test('checkExtension: a manifest changed but not repackaged (inner manifest drift) is caught', () => {
  // The zip carries the OLD manifest (0.0.9); the source manifest + latest.json say 0.1.0, so version + bytes
  // match the served zip but the embedded manifest is stale.
  const zipBuf = fullZip({ ...M, version: '0.0.9' });
  const latest = { ...latestFor(zipBuf, M), version: M.version };
  const errors = checkExtension({ manifest: M, latest, zipBuf });
  assert.ok(errors.some((e) => /inside the served zip differs/.test(e)), JSON.stringify(errors));
});

test('checkExtension: a missing/empty zip is caught', () => {
  assert.ok(checkExtension({ manifest: M, latest: { ...latestFor(Buffer.alloc(10)) }, zipBuf: null }).some((e) => /missing or empty/.test(e)));
});
