// The og:image:width / og:image:height lookup. A wrong number is worse than a missing one, so the tests that
// matter most here are the NEGATIVE ones: an image whose size we do not know must report null and the page
// must then emit no dimensions at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { knownImageSize, imageFieldSize } from '../src/lib/og-image-size.mjs';
import { checkOgImageSizes, readOgTags } from '../scripts/check-og-image-size.mjs';

test('knownImageSize reports the real size of each YouTube thumbnail variant', () => {
  assert.deepEqual(knownImageSize('https://i.ytimg.com/vi/MsFYd8EdAXw/maxresdefault.jpg'), { width: 1280, height: 720 });
  assert.deepEqual(knownImageSize('https://i.ytimg.com/vi/MsFYd8EdAXw/sddefault.jpg'), { width: 640, height: 480 });
  assert.deepEqual(knownImageSize('https://i.ytimg.com/vi/MsFYd8EdAXw/hqdefault.jpg'), { width: 480, height: 360 });
  assert.deepEqual(knownImageSize('https://i.ytimg.com/vi/MsFYd8EdAXw/mqdefault.jpg'), { width: 320, height: 180 });
  // the WebP mirror and the alternate CDN hosts are the same images
  assert.deepEqual(knownImageSize('https://i.ytimg.com/vi_webp/abc123/maxresdefault.webp'), { width: 1280, height: 720 });
  assert.deepEqual(knownImageSize('https://img.youtube.com/vi/abc123/hqdefault.jpg'), { width: 480, height: 360 });
});

test('knownImageSize knows the branded default card, absolute or root-relative', () => {
  assert.deepEqual(knownImageSize('/og-image.png'), { width: 1200, height: 630 });
  assert.deepEqual(knownImageSize('https://gbti.network/og-image.png'), { width: 1200, height: 630 });
});

test('knownImageSize returns null rather than guessing at an image it does not recognize', () => {
  assert.equal(knownImageSize('https://example.com/cover.png'), null);          // a member cover image
  assert.equal(knownImageSize('https://i.ytimg.com/vi/abc/unknownname.jpg'), null); // a variant not in the map
  assert.equal(knownImageSize('https://gbti.network/media/x/cover.webp'), null); // our own repo media
  assert.equal(knownImageSize('not a url at all ::'), null);
  assert.equal(knownImageSize(''), null);
  assert.equal(knownImageSize(null), null);
  assert.equal(knownImageSize(undefined), null);
});

test('sow-294: every branded default banner is known, and the table matches the real files (measured, not assumed)', async () => {
  const dir = 'public/brand/feature';
  const files = fs.readdirSync(dir).filter((f) => /^feature-[a-z]+\.png$/.test(f));
  assert.ok(files.length >= 8, `banners found (${files.length})`);
  for (const f of files) {
    const meta = await sharp(path.join(dir, f)).metadata();
    assert.deepEqual(knownImageSize(`/brand/feature/${f}`), { width: meta.width, height: meta.height }, f);
    assert.deepEqual(knownImageSize(`https://gbti.network/brand/feature/${f}`), { width: meta.width, height: meta.height }, f);
  }
  assert.equal(knownImageSize('/brand/feature/news/x.png'), null, 'only the per-type banners, not everything under the folder');
  assert.equal(knownImageSize('https://example.com/brand/feature/feature-article.png'), null, 'our path on another host is not ours');
});

test('sow-294: imageFieldSize reads an Astro image field, and nothing else', () => {
  assert.deepEqual(imageFieldSize({ src: '/_astro/c.webp', width: 1600, height: 900, format: 'webp' }), { width: 1600, height: 900 });
  for (const v of [undefined, null, '/_astro/c.webp', { src: 'x' }, { width: 0, height: 10 }, { width: 10.5, height: 10 }, { width: '1600', height: '900' }]) {
    assert.equal(imageFieldSize(v), undefined, JSON.stringify(v));
  }
});

function fakeDist(pages) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-og-size-'));
  for (const [rel, html] of Object.entries(pages)) {
    fs.mkdirSync(path.join(dist, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), html);
  }
  return dist;
}
const page = (img, w, h) => `<html><head><meta property="og:image" content="${img}">${w ? `<meta property="og:image:width" content="${w}">` : ''}${h ? `<meta property="og:image:height" content="${h}">` : ''}</head></html>`;
const SIZES = { 'a.webp': { width: 1600, height: 900 }, 'feature-article.png': { width: 1200, height: 630 } };
const measure = async (p) => { const s = SIZES[path.basename(p)]; if (!s) throw new Error('unexpected file'); return s; };

test('sow-294 guard: matching sizes pass; a missing size, a wrong size, a missing file and an empty section fail', async () => {
  const good = {
    'articles/one/index.html': page('https://gbti.network/_astro/a.webp', 1600, 900),
    'projects/p/index.html': page('https://gbti.network/brand/feature/feature-article.png', 1200, 630),
    'prompts/q/index.html': page('https://gbti.network/_astro/a.webp', 1600, 900),
    'shares/ann/s1/index.html': page('https://gbti.network/_astro/a.webp', 1600, 900),
    'shares/ann/s2/index.html': page('https://mlq.ai/outside.png'),
    '_astro/a.webp': 'x', 'brand/feature/feature-article.png': 'x',
  };
  const ok = await checkOgImageSizes({ distDir: fakeDist(good), measure });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.checked, { articles: 1, projects: 1, prompts: 1, shares: 1 }, 'the outside share image is exempt, not counted');
  const fail = async (over, pattern) => {
    const r = await checkOgImageSizes({ distDir: fakeDist({ ...good, ...over }), measure });
    assert.match(r.errors.join('\n'), pattern);
  };
  await fail({ 'articles/one/index.html': page('https://gbti.network/_astro/a.webp') }, /declares no width\/height/);
  await fail({ 'articles/one/index.html': page('https://gbti.network/_astro/a.webp', 1200, 630) }, /declares 1200x630 but \/_astro\/a\.webp is 1600x900/);
  await fail({ 'articles/one/index.html': page('https://gbti.network/_astro/gone.webp', 1, 1) }, /is not in dist/);
  const noPrompts = { ...good };
  delete noPrompts['prompts/q/index.html'];
  const empty = await checkOgImageSizes({ distDir: fakeDist(noPrompts), measure });
  assert.match(empty.errors.join('\n'), /prompts: no built pages found/, 'a section with no pages fails rather than passing on zero');
  assert.deepEqual(readOgTags(page('https://gbti.network/x.png', 10, 20)), { image: 'https://gbti.network/x.png', width: '10', height: '20' });
});
