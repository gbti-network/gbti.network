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

test('the canonical co-located shape is staged, and so is the flat one a pre-fix draft still holds', () => {
  // ./images/<file> is what the stager writes now and the ONLY shape Astro's image() resolves. The store
  // lookup is scoped to one draft by the caller, so a same-named image under another draft cannot answer.
  assert.equal(isStagedImagePath('./images/shot.png'), true);
  assert.equal(isStagedImagePath('./images/a-b_1.WEBP'), true);
  // The flat shape the website stager wrote until this was fixed. A draft saved before then still holds one,
  // and it should show its picture rather than a broken frame while publish normalizes it.
  assert.equal(isStagedImagePath('members/atwellpub/images/shot.png'), true);
  assert.equal(isStagedImagePath('members/gbti-labs/images/a-b_1.WEBP'), true);
  // Neither an already-resolved URL nor a deeper repo path is ours to look up.
  assert.equal(isStagedImagePath('members/atwellpub/prompts/grok/images/shot.png'), false);
  assert.equal(isStagedImagePath('https://example.com/shot.png'), false);
  assert.equal(isStagedImagePath('/_astro/shot.hash.webp'), false);
  assert.equal(isStagedImagePath('./images/notes.md'), false);
  assert.equal(isStagedImagePath('members/atwellpub/images/notes.md'), false);
  assert.equal(isStagedImagePath(''), false);
  assert.equal(isStagedImagePath(null), false);
});

test('stagedImageName is the store key, and refuses a path it would not look up', () => {
  assert.equal(stagedImageName('./images/shot.png'), 'shot.png');
  assert.equal(stagedImageName('members/atwellpub/images/shot.png'), 'shot.png');
  assert.equal(stagedImageName('https://example.com/shot.png'), null);
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
    './images/co-located.png',
    './images/local.png',
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

test('loadStagedImages asks by file NAME, only about staged-shaped paths, and never twice', async () => {
  const asked = [];
  const read = async (name) => { asked.push(name); return { dataBase64: 'AAA=', contentType: 'image/png' }; };
  const out = await loadStagedImages(
    ['./images/x.png', 'members/a/images/y.png', 'https://example.com/z.png', './images/x.png'],
    read,
  );
  // The store is keyed by name (the caller binds the item), while the RESULT is keyed by the value exactly as
  // it appears in the field, because that is what every caller looks up as _stagedSrc[value].
  assert.deepEqual(asked, ['x.png', 'y.png']);
  assert.deepEqual(out, {
    './images/x.png': 'data:image/png;base64,AAA=',
    'members/a/images/y.png': 'data:image/png;base64,AAA=',
  });
});

test('a path the caller already holds is not re-fetched', async () => {
  let calls = 0;
  const read = async () => { calls += 1; return { dataBase64: 'AAA=' }; };
  const out = await loadStagedImages(['./images/x.png'], read, { './images/x.png': 'data:image/png;base64,OLD' });
  assert.equal(calls, 0);
  assert.deepEqual(out, {});
});

test('a miss and a throwing read both fall back to the CDN instead of failing', async () => {
  // "not staged" is the NORMAL steady state once the publish PR merges: the key is deleted and jsDelivr serves
  // the real file. It must never surface as an error, or every published item would report one.
  assert.deepEqual(await loadStagedImages(['./images/x.png'], async () => null), {});
  assert.deepEqual(await loadStagedImages(['./images/x.png'], async () => { throw new Error('offline'); }), {});
  // A host with no staged store at all (the npm client stages to disk; the extension has no stager).
  assert.deepEqual(await loadStagedImages(['./images/x.png'], undefined), {});
});
