// src/lib/staged-images.mjs -- which draft images are worth asking the staged store about, and reading them back.
//
// The defect these close: an uploaded image is committed with its content in ONE publish PR, so until that PR
// merges the bytes are only in the Worker's staged store. Every surface resolved the image PATH against
// jsDelivr over main, which 404s in that window, so the editor showed a broken thumbnail and the preview a
// broken image, and a reload made it permanent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStagedImagePath, stagedImageName, referencedDraftImages, stagedImageDataUrl, loadStagedImages,
} from '../src/lib/staged-images.mjs';

test('only the flat own-folder shape the website stager produces is treated as staged', () => {
  assert.equal(isStagedImagePath('members/atwellpub/images/shot.png'), true);
  assert.equal(isStagedImagePath('members/gbti-labs/images/a-b_1.WEBP'), true);
  // A co-located path comes from the npm client, which writes to DISK and stages nothing. Asking the store
  // about it could only ever produce a false hit on a same-named image from a different item, because the
  // store is keyed by file name.
  assert.equal(isStagedImagePath('./images/shot.png'), false);
  assert.equal(isStagedImagePath('members/atwellpub/prompts/grok/images/shot.png'), false);
  assert.equal(isStagedImagePath('https://example.com/shot.png'), false);
  assert.equal(isStagedImagePath('/_astro/shot.hash.webp'), false);
  assert.equal(isStagedImagePath('members/atwellpub/images/notes.md'), false);
  assert.equal(isStagedImagePath(''), false);
  assert.equal(isStagedImagePath(null), false);
});

test('stagedImageName is the store key, and refuses a path it would not look up', () => {
  assert.equal(stagedImageName('members/atwellpub/images/shot.png'), 'shot.png');
  assert.equal(stagedImageName('./images/shot.png'), null);
});

test('referencedDraftImages finds the paths wherever the frontmatter keeps them', () => {
  const fm = {
    title: 'A prompt',
    image: 'members/atwellpub/images/lead.png',
    banner: 'https://example.com/remote.png',              // absolute: the CDN is not involved
    gallery: [{ src: 'members/atwellpub/images/shot-1.webp', caption: 'one' }, { src: './images/local.png' }],
    links: [{ url: 'https://example.com', icon: 'members/atwellpub/images/icon.gif' }],
  };
  const body = 'Text\n\n![alt](members/atwellpub/images/in-body.jpg)\n\n<img src="./images/co-located.png">';
  const found = referencedDraftImages(fm, body);
  assert.deepEqual(found.sort(), [
    'members/atwellpub/images/icon.gif',
    'members/atwellpub/images/in-body.jpg',
    'members/atwellpub/images/lead.png',
    'members/atwellpub/images/shot-1.webp',
  ]);
});

test('referencedDraftImages dedupes, and survives frontmatter that will not stringify', () => {
  const dup = { image: 'members/a/images/x.png', ogImage: 'members/a/images/x.png' };
  assert.deepEqual(referencedDraftImages(dup, 'members/a/images/x.png'), ['members/a/images/x.png']);
  const cyclic = {}; cyclic.self = cyclic;
  assert.deepEqual(referencedDraftImages(cyclic, 'members/a/images/y.png'), ['members/a/images/y.png']);
  assert.deepEqual(referencedDraftImages(), []);
});

test('stagedImageDataUrl builds a usable src, and returns nothing for an empty payload', () => {
  assert.equal(stagedImageDataUrl({ dataBase64: 'AAA=', contentType: 'image/webp' }), 'data:image/webp;base64,AAA=');
  assert.equal(stagedImageDataUrl({ dataBase64: 'AAA=' }), 'data:image/png;base64,AAA=');
  assert.equal(stagedImageDataUrl({ dataBase64: '' }), '');
  assert.equal(stagedImageDataUrl(null), '');
});

test('loadStagedImages asks only about staged-shaped paths, and never twice', async () => {
  const asked = [];
  const read = async (p) => { asked.push(p); return { dataBase64: 'AAA=', contentType: 'image/png' }; };
  const out = await loadStagedImages(
    ['members/a/images/x.png', './images/y.png', 'https://example.com/z.png', 'members/a/images/x.png'],
    read,
  );
  assert.deepEqual(asked, ['members/a/images/x.png']);
  assert.deepEqual(out, { 'members/a/images/x.png': 'data:image/png;base64,AAA=' });
});

test('a path the caller already holds is not re-fetched', async () => {
  let calls = 0;
  const read = async () => { calls += 1; return { dataBase64: 'AAA=' }; };
  const out = await loadStagedImages(['members/a/images/x.png'], read, { 'members/a/images/x.png': 'data:image/png;base64,OLD' });
  assert.equal(calls, 0);
  assert.deepEqual(out, {});
});

test('a miss and a throwing read both fall back to the CDN instead of failing', async () => {
  // "not staged" is the NORMAL steady state once the publish PR merges: the key is deleted and jsDelivr serves
  // the real file. It must never surface as an error, or every published item would report one.
  assert.deepEqual(await loadStagedImages(['members/a/images/x.png'], async () => null), {});
  assert.deepEqual(await loadStagedImages(['members/a/images/x.png'], async () => { throw new Error('offline'); }), {});
  // A host with no staged store at all (the npm client stages to disk; the extension has no stager).
  assert.deepEqual(await loadStagedImages(['members/a/images/x.png'], undefined), {});
});
