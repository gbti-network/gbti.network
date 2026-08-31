import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_MAX_BYTES,
  imageMimeForFile,
  firstImageFile,
  planReencode,
  outputNameFor,
  processedImageDataUrl,
  processImageFile,
} from '../client-ui/src/image-intake.mjs';

const namedBlob = (name, type, bytes = 32) => Object.assign(new Blob([new Uint8Array(bytes)], { type }), { name });

test('image intake recognises supported MIME types and file extensions', () => {
  assert.equal(imageMimeForFile({ name: 'photo.JPG', type: '' }), 'image/jpeg');
  assert.equal(imageMimeForFile({ name: 'shot.bin', type: 'image/png' }), 'image/png');
  assert.equal(imageMimeForFile({ name: 'notes.txt', type: 'text/plain' }), '');
  const png = namedBlob('shot.png', 'image/png');
  assert.equal(firstImageFile({ types: ['Files'], files: [{ name: 'x.txt', type: 'text/plain' }, png] }), png);
  assert.equal(firstImageFile({ types: ['Files'], files: [], items: [{ kind: 'file', getAsFile: () => png }] }), png);
  assert.equal(firstImageFile({ types: ['text/plain'], files: [] }), null);
});

test('photos are clamped to 2400px and become WebP while PNG stays PNG', () => {
  assert.deepEqual(planReencode({ width: 6000, height: 4000, type: 'image/jpeg' }), {
    passthrough: false, width: 2400, height: 1600, outputType: 'image/webp', quality: 0.82,
  });
  assert.deepEqual(planReencode({ width: 800, height: 1200, type: 'image/png' }), {
    passthrough: false, width: 800, height: 1200, outputType: 'image/png', quality: null,
  });
});

test('output names are sanitized, converted and suffixed without overwriting', () => {
  assert.equal(outputNameFor('My Vacation.JPG', 'image/webp', []), 'my-vacation.webp');
  assert.equal(outputNameFor('My Vacation.JPG', 'image/webp', ['./images/my-vacation.webp']), 'my-vacation-2.webp');
  assert.equal(outputNameFor('Shot.PNG', 'image/png', ['shot.png', 'SHOT-2.PNG']), 'shot-3.png');
});

test('processing draws decoded pixels and returns only the re-encoded blob', async () => {
  const calls = [];
  let closed = false;
  const file = namedBlob('Camera Photo.jpg', 'image/jpeg', 5000);
  const result = await processImageFile(file, {
    usedNames: ['camera-photo.webp'],
    decode: async () => ({ width: 6000, height: 4000, close: () => { closed = true; } }),
    makeCanvas: (width, height) => ({
      getContext: () => ({ drawImage: (_image, x, y, w, h) => calls.push({ x, y, w, h }) }),
      convertToBlob: async (options) => { calls.push(options); return new Blob([new Uint8Array(9000)], { type: options.type }); },
      width, height,
    }),
  });
  assert.equal(result.name, 'camera-photo-2.webp');
  assert.equal(result.type, 'image/webp');
  assert.equal(result.width, 2400);
  assert.equal(result.height, 1600);
  assert.equal(result.blob.size, 9000);
  assert.equal(result.blob === file, false, 'the original metadata-bearing blob must never be returned');
  assert.deepEqual(calls, [{ x: 0, y: 0, w: 2400, h: 1600 }, { type: 'image/webp', quality: 0.82 }]);
  assert.equal(closed, true);
  assert.match(result.message, /Embedded metadata removed/);
});

test('processed previews use a CSP-compatible data URL, not a blob URL', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
  assert.equal(processedImageDataUrl(blob, 'AQID'), 'data:image/webp;base64,AQID');
  assert.throws(() => processedImageDataUrl(blob, ''), /preview could not be created/);
});

test('a processed image over 1MB is refused and the original is never substituted', async () => {
  await assert.rejects(
    processImageFile(namedBlob('large.png', 'image/png'), {
      decode: async () => ({ width: 100, height: 100 }),
      makeCanvas: () => ({
        getContext: () => ({ drawImage() {} }),
        convertToBlob: async () => new Blob([new Uint8Array(IMAGE_MAX_BYTES + 1)], { type: 'image/png' }),
      }),
    }),
    /still over 1 MB after processing/,
  );
});

test('animated GIF bytes pass through unchanged, but never above the stored cap', async () => {
  const gif = namedBlob('dance.gif', 'image/gif', 100);
  const kept = await processImageFile(gif);
  assert.equal(kept.blob, gif);
  assert.equal(kept.reencoded, false);
  assert.match(kept.message, /kept unchanged/);
  await assert.rejects(processImageFile(namedBlob('huge.gif', 'image/gif', IMAGE_MAX_BYTES + 1)), /over 1 MB/);
});

test('decode failure is explicit and does not upload original bytes', async () => {
  await assert.rejects(
    processImageFile(namedBlob('broken.jpg', 'image/jpeg'), { decode: async () => { throw new Error('bad'); } }),
    /No original bytes were uploaded/,
  );
});
