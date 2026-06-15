// SOW-019: package the built MV3 extension into a distributable zip served by the static site, plus a
// latest.json version manifest. Run AFTER bundling (or via `npm run build:extension`, which builds first).
// Dependency-free ZIP writer (CRC32 + zlib DEFLATE) so it works in any build/CI environment without a zip
// binary. Output is committed under public/extension/ so the Cloudflare Pages build serves it verbatim.
//   node extension/package.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');

// ---- minimal ZIP (store path names, DEFLATE-compressed entries) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** entries: [{ name, data: Buffer }] -> a valid .zip Buffer (DEFLATE, fixed 1980 mtime for reproducibility). */
export function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const comp = zlib.deflateRawSync(e.data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 6); lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(0, 10); lfh.writeUInt16LE(0x21, 12); lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18); lfh.writeUInt32LE(e.data.length, 22);
    lfh.writeUInt16LE(name.length, 26); lfh.writeUInt16LE(0, 28);
    parts.push(lfh, name, comp);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10); cdh.writeUInt16LE(0, 12); cdh.writeUInt16LE(0x21, 14); cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20); cdh.writeUInt32LE(e.data.length, 24); cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt16LE(0, 30); cdh.writeUInt16LE(0, 32); cdh.writeUInt16LE(0, 34); cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38); cdh.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cdh, name]));
    offset += lfh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, eocd]);
}

/** Parse a zip produced by zip() back into [{ name, data: Buffer }] (central-directory walk + inflate). Used by
 *  the check:extension drift guard + tests so the packaging logic has exactly one reader. */
export function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip (bad central directory header)');
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('corrupt zip (bad local file header)');
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    entries.push({ name, data: zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compSize)) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The loadable file set for the Chrome zip, DISCOVERED from disk (not hand-listed) so a page or bundle added
 *  by a later SOW is never forgotten: the manifest, every top-level *.html page, and every built dist/*.js
 *  bundle. The mcp/ folder is intentionally excluded (a node bundle, not a browser file). Paths are preserved
 *  so the unzipped folder loads directly. */
export function loadableFiles(extDir) {
  const html = fs.readdirSync(extDir).filter((f) => f.endsWith('.html')).sort();
  const distDir = path.join(extDir, 'dist');
  const dist = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')).sort().map((f) => `dist/${f}`)
    : [];
  const iconsDir = path.join(extDir, 'icons');
  const icons = fs.existsSync(iconsDir)
    ? fs.readdirSync(iconsDir).filter((f) => /\.(png|svg|webp)$/i.test(f)).sort().map((f) => `icons/${f}`)
    : [];
  return ['manifest.json', ...html, ...dist, ...icons];
}

/** The files the extension REQUIRES to be present, derived from the manifest (service worker, content scripts,
 *  popup, every chrome_url_overrides page) plus each packaged HTML page's local <script src>. The drift guard
 *  asserts every one of these is in the zip, so a manifest-declared resource (e.g. the newtab override) that
 *  was not packaged is caught instead of shipping a broken extension. htmlSources: { name -> html string }. */
export function requiredFiles(manifest, htmlSources = {}) {
  const req = new Set(['manifest.json']);
  if (manifest.background?.service_worker) req.add(manifest.background.service_worker);
  for (const cs of manifest.content_scripts ?? []) for (const j of cs.js ?? []) req.add(j);
  if (manifest.action?.default_popup) req.add(manifest.action.default_popup);
  for (const v of Object.values(manifest.chrome_url_overrides ?? {})) req.add(v);
  // Icon files declared in the manifest (install icons + the toolbar action icon) must be packaged too, or the
  // extension loads with a broken/placeholder icon.
  for (const p of Object.values(manifest.icons ?? {})) req.add(p);
  for (const p of Object.values(manifest.action?.default_icon ?? {})) req.add(p);
  for (const html of Object.values(htmlSources)) {
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      if (!/^https?:\/\//.test(m[1])) req.add(m[1].replace(/^\.?\//, ''));
    }
  }
  return req;
}

// ---- package the extension ----
export function packageExtension({ root = ROOT, write = true } = {}) {
  const extDir = path.join(root, 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
  const files = loadableFiles(extDir);
  const present = new Set(files);
  const htmlSources = Object.fromEntries(files.filter((f) => f.endsWith('.html')).map((f) => [f, fs.readFileSync(path.join(extDir, f), 'utf8')]));
  const missing = [...requiredFiles(manifest, htmlSources)].filter((f) => !present.has(f));
  if (missing.length) throw new Error(`extension not built (missing ${missing.join(', ')}); run node extension/build.mjs first`);
  const entries = files.map((f) => ({ name: f, data: fs.readFileSync(path.join(extDir, f)) }));

  const buf = zip(entries);
  const zipName = 'gbti-network-extension.zip';
  // Version manifest the site reads. webStoreUrl stays empty until the M0 store submission; the site falls
  // back to the direct zip while it is empty.
  const latest = {
    version: manifest.version,
    name: manifest.name,
    zip: `/extension/${zipName}`,
    webStoreUrl: '',
    bytes: buf.length,
  };
  if (write) {
    const outDir = path.join(root, 'public/extension');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, zipName), buf);
    fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  }
  return { ...latest, buf, entries: entries.length };
}

// CLI: build first (importing build.mjs runs it), then package.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./build.mjs');
  const r = packageExtension();
  console.log(`packaged extension v${r.version}: public/extension/gbti-network-extension.zip (${(r.bytes / 1024).toFixed(0)} KB, ${r.entries} files) + latest.json`);
}
