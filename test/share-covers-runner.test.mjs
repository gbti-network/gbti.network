// sow-283 / sow-272: the share-covers runner against a temporary repo, with the network faked. Covers the three
// promises the workflow rests on: stage 1 never asks for a members-only share and records every outcome, ingest
// refuses anything that is not a verified copy, and stage 2 switches a share ONLY when the exact bytes are live.
// Also the build guard that keeps a non-public share's copy out of dist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import yaml from 'js-yaml';
import { sniffImage, toCopy, runFetch, runIngest, runSwitch, MAX_COPY_BYTES } from '../scripts/share-covers.mjs';
import { shareCoverUrl } from '../membership/share-cover-url.mjs';
import { checkBuildSecrets } from '../scripts/check-build-secrets.mjs';

const NOW = Date.parse('2026-09-14T12:00:00Z');
const quiet = () => {};

function repo(shares) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-covers-'));
  for (const [rel, fm] of Object.entries(shares)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n\nA note.\n`);
  }
  return root;
}
const fmOf = (root, rel) => yaml.load(/^---\n([\s\S]*?)---/.exec(fs.readFileSync(path.join(root, rel), 'utf8'))[1]);
const png = (w = 2000, h = 1000) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 140, b: 90 } } }).png().toBuffer();

test('sniffImage and toCopy: rasters become a WebP inside the caps; SVG, HTML and junk never reach the decoder', async () => {
  const big = await png(3000, 1500);
  assert.equal(sniffImage(big), 'png');
  const { out } = await toCopy(big);
  assert.equal(sniffImage(out), 'webp');
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1280, 'resized down');
  assert.ok(out.length <= MAX_COPY_BYTES);
  const small = await toCopy(await png(200, 100));
  assert.equal((await sharp(small.out).metadata()).width, 200, 'never enlarged');
  for (const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), Buffer.from('<!doctype html><html></html>'), Buffer.alloc(40), Buffer.from('GIF8')]) {
    assert.deepEqual(await toCopy(bad), { error: 'not-image' });
  }
  assert.deepEqual(await toCopy(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)])), { error: 'not-image' }, 'a JPEG signature on garbage fails inside sharp, softly');
  // A format sharp WOULD decode but the allowlist does not name. Only the signature check refuses it, so this is
  // the case that proves the check runs before the decoder rather than the decoder happening to refuse the input.
  const tiff = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } } }).tiff().toBuffer();
  assert.equal((await sharp(tiff).metadata()).format, 'tiff', 'control: sharp itself reads this input');
  assert.deepEqual(await toCopy(tiff), { error: 'not-image' });
});

test('runFetch: copies public shares, looks up an image-less one, records failures, never requests a members share', async () => {
  const root = repo({
    'members/ann/shares/s1.md': { id: 's1', author: 'ann', status: 'published', visibility: 'public', url: 'https://a.test/post', image: 'https://img.test/a.png' },
    'members/ann/shares/s2.md': { id: 's2', author: 'ann', status: 'published', visibility: 'public', url: 'https://b.test/page' },
    'members/ann/shares/s3.md': { id: 's3', author: 'ann', status: 'published', visibility: 'public', url: 'https://c.test/none' },
    'members/ann/shares/s4.md': { id: 's4', author: 'ann', status: 'published', visibility: 'public', image: 'https://img.test/404.png' },
    'members/bob/shares/m1.md': { id: 'm1', author: 'bob', status: 'published', visibility: 'members', url: 'https://secret.test/x', image: 'https://secret.test/x.png' },
    'members/bob/shares/r1.md': { id: 'r1', author: 'bob', status: 'published', visibility: 'public', url: 'https://d.test/removed', imageRemoved: true },
  });
  const image = await png();
  const seen = [];
  const get = async (url) => {
    seen.push(url);
    if (url === 'https://img.test/a.png' || url === 'https://b.test/og.png') return { ok: true, contentType: 'image/png', body: image, finalUrl: url };
    if (url === 'https://b.test/page') return { ok: true, contentType: 'text/html', body: Buffer.from('<meta property="og:image" content="/og.png">'), finalUrl: url };
    if (url === 'https://c.test/none') return { ok: true, contentType: 'text/html', body: Buffer.from('<title>no image</title>'), finalUrl: url };
    return { ok: false, reason: 'http-404' };
  };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-covers-out-'));
  const r = await runFetch({ outDir, get, now: NOW, log: quiet, root });
  assert.equal(r.written, 2);
  assert.ok(!seen.some((u) => u.includes('secret.test')), 'a members-only share is never fetched');
  assert.ok(!seen.some((u) => u.includes('d.test')), 'a removed preview is never looked up');
  const covers = yaml.load(fs.readFileSync(path.join(outDir, 'house/share-covers.yml'), 'utf8')).covers;
  assert.equal(covers['ann/s1'].source, 'https://img.test/a.png');
  assert.match(covers['ann/s1'].file, /^s1-[0-9a-f]{8}\.webp$/);
  const written = fs.readFileSync(path.join(outDir, 'members/ann/shares/images', covers['ann/s1'].file));
  assert.equal(crypto.createHash('sha256').update(written).digest('hex'), covers['ann/s1'].sha256);
  assert.equal(covers['ann/s2'].lookup, 'https://b.test/page');
  assert.equal(covers['ann/s2'].source, 'https://b.test/og.png', 'a relative og:image resolves against the page');
  assert.deepEqual(covers['ann/s3'], { lookup: 'https://c.test/none', failed: 'no-preview', triedAt: '2026-09-14' });
  assert.deepEqual(covers['ann/s4'], { source: 'https://img.test/404.png', failed: 'http-404', triedAt: '2026-09-14' });
  assert.equal(covers['bob/m1'], undefined);
  assert.ok(!fs.existsSync(path.join(root, 'members/ann/shares/images')), 'stage 1 writes only to its output dir');
});

test('runIngest: a verified copy and the manifest are copied in; anything else refuses the WHOLE ingest', async () => {
  const root = repo({ 'members/ann/shares/s1.md': { id: 's1', author: 'ann', status: 'published', visibility: 'public' } });
  const { out } = await toCopy(await png());
  const hash = crypto.createHash('sha256').update(out).digest('hex').slice(0, 8);
  const stage = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-covers-in-'));
    for (const [rel, bytes] of Object.entries(files)) { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), bytes); }
    return dir;
  };
  const good = { [`members/ann/shares/images/s1-${hash}.webp`]: out, 'house/share-covers.yml': 'covers:\n  ann/s1:\n    source: https://x.test/a.png\n' };
  for (const [label, extra] of [
    ['a path outside the copy dirs', { 'src/pages/evil.astro': 'x' }],
    ['a copy for a share that does not exist', { [`members/ann/shares/images/nope-${hash}.webp`]: out }],
    ['a name whose hash does not match the bytes', { 'members/ann/shares/images/s1-00000000.webp': out }],
    ['bytes that are not a WebP under a webp name', { [`members/ann/shares/images/s1-${crypto.createHash('sha256').update(Buffer.from('x')).digest('hex').slice(0, 8)}.webp`]: Buffer.from('x') }],
    ['a share markdown file', { 'members/ann/shares/s1.md': '---\nstatus: draft\n---\n' }],
    ['a malformed manifest', { 'house/share-covers.yml': 'covers: nope\n' }],
  ]) {
    const r = runIngest(stage({ ...good, ...extra }), { root });
    assert.equal(r.ok, false, label);
    assert.ok(!fs.existsSync(path.join(root, 'members/ann/shares/images')), `${label}: nothing was copied`);
  }
  const oversize = Buffer.concat([out, Buffer.alloc(MAX_COPY_BYTES)]);
  const oh = crypto.createHash('sha256').update(oversize).digest('hex').slice(0, 8);
  assert.equal(runIngest(stage({ [`members/ann/shares/images/s1-${oh}.webp`]: oversize }), { root }).ok, false, 'over the size cap');
  const r = runIngest(stage(good), { root });
  assert.deepEqual(r, { ok: true, copied: 2 });
  assert.ok(fs.existsSync(path.join(root, `members/ann/shares/images/s1-${hash}.webp`)));
});

test('runSwitch: switches ONLY on byte-identical live copies, restores a share gone members-only, deletes stale copies', async () => {
  const { out } = await toCopy(await png());
  const sha256 = crypto.createHash('sha256').update(out).digest('hex');
  const file = `s1-${sha256.slice(0, 8)}.webp`;
  const url = shareCoverUrl('ann', file);
  const root = repo({
    'members/ann/shares/s1.md': { id: 's1', author: 'ann', status: 'published', visibility: 'public', url: 'https://a.test/p', image: 'https://img.test/a.png' },
    'members/ann/shares/s2.md': { id: 's2', author: 'ann', status: 'published', visibility: 'members', image: shareCoverUrl('ann', 's2-11111111.webp'), imageSource: 'https://img.test/b.png' },
  });
  fs.mkdirSync(path.join(root, 'members/ann/shares/images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'members/ann/shares/images', file), out);
  fs.writeFileSync(path.join(root, 'members/ann/shares/images/s2-11111111.webp'), out);
  fs.mkdirSync(path.join(root, 'house'));
  fs.writeFileSync(path.join(root, 'house/share-covers.yml'), yaml.dump({ covers: { 'ann/s1': { source: 'https://img.test/a.png', file, sha256 }, 'ann/s2': { source: 'https://img.test/b.png' } } }));

  const before = fs.readFileSync(path.join(root, 'members/ann/shares/s1.md'), 'utf8');
  const dry = await runSwitch({ root, now: NOW, log: quiet, get: async () => ({ ok: true, body: out }) });
  assert.ok(dry.changed.length > 0);
  assert.equal(fs.readFileSync(path.join(root, 'members/ann/shares/s1.md'), 'utf8'), before, 'a dry run writes nothing');

  await runSwitch({ root, apply: true, now: NOW, log: quiet, get: async () => ({ ok: true, body: Buffer.from('an older copy') }) });
  assert.equal(fmOf(root, 'members/ann/shares/s1.md').image, 'https://img.test/a.png', 'different bytes live: not switched');
  assert.equal(fmOf(root, 'members/ann/shares/s2.md').image, 'https://img.test/b.png', 'the members share got its original back');
  assert.equal('imageSource' in fmOf(root, 'members/ann/shares/s2.md'), false);
  assert.ok(!fs.existsSync(path.join(root, 'members/ann/shares/images/s2-11111111.webp')), "the members share's copy is deleted");
  assert.equal(yaml.load(fs.readFileSync(path.join(root, 'house/share-covers.yml'), 'utf8')).covers['ann/s2'], undefined);

  const asked = [];
  await runSwitch({ root, apply: true, now: NOW, log: quiet, get: async (u) => { asked.push(u); return { ok: true, body: out }; } });
  assert.deepEqual(asked, [url], 'the live check downloads our own URL');
  const fm = fmOf(root, 'members/ann/shares/s1.md');
  assert.equal(fm.image, url);
  assert.equal(fm.imageSource, 'https://img.test/a.png');
  const again = await runSwitch({ root, apply: true, now: NOW, log: quiet, get: async () => { throw new Error('a settled repo asks for nothing'); } });
  assert.deepEqual(again.changed, [], 'the loop ends: a second run finds nothing to do');
});

test('build guard: a public share may have hosted copies in dist; a members or draft share, or a stray name, fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-guard-covers-'));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<html>ok</html>');
  fs.mkdirSync(path.join(root, 'members/ann/shares'), { recursive: true });
  fs.writeFileSync(path.join(root, 'members/ann/shares/pub-1.md'), '---\nstatus: published\nvisibility: public\nid: pub-1\nauthor: ann\n---\n');
  fs.writeFileSync(path.join(root, 'members/ann/shares/priv-1.md'), '---\nstatus: published\nvisibility: members\nid: priv-1\nauthor: ann\n---\n');
  const covers = path.join(root, 'dist/media/shares/ann');
  fs.mkdirSync(covers, { recursive: true });
  fs.writeFileSync(path.join(covers, 'pub-1-0123abcd.webp'), 'x');
  assert.deepEqual(checkBuildSecrets({ root, env: {} }).errors, []);
  fs.writeFileSync(path.join(covers, 'priv-1-0123abcd.webp'), 'x');
  assert.match(checkBuildSecrets({ root, env: {} }).errors.join('\n'), /priv-1-0123abcd\.webp/);
  fs.rmSync(path.join(covers, 'priv-1-0123abcd.webp'));
  fs.writeFileSync(path.join(covers, 'notes.txt'), 'x');
  assert.match(checkBuildSecrets({ root, env: {} }).errors.join('\n'), /notes\.txt/);
  fs.rmSync(root, { recursive: true, force: true });
});
