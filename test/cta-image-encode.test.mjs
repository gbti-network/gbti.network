// sow-337: the in-browser step before a card image leaves the superadmin's machine (client-ui/src/cta-image-encode.mjs).
// The canvas encode is injected here; what is tested is the decision around it: always re-encode, walk the size ladder
// until the file fits, refuse a browser that silently returns something other than WebP, and run the server's own
// metadata check on the bytes before they are offered for saving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCtaImage, CTA_IMAGE_LADDER, CTA_IMAGE_TYPES } from '../client-ui/src/cta-image-encode.mjs';
import { CTA_IMAGE_MAX_BYTES, webpInfo } from '../membership/cta-image.mjs';

const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
// Real encoder output (the samples test/cta-image.test.mjs reads): a clean 9x7 WebP, one carrying EXIF, and what
// Chrome 148's canvas writes, which carries an sRGB colour profile.
const LOSSY = 'UklGRjIAAABXRUJQVlA4ICYAAABwAQCdASoJAAcAAsBMJaACdAFAAAD+3FFB8XL/+QY/wa/zD5rgAA==';
const EXIF = 'UklGRjABAABXRUJQVlA4WAoAAAAIAAAACAAABgAAVlA4ICYAAABwAQCdASoJAAcAAsBMJaACdAFAAAD+3FFB8XL/+QY/wa/zD5rgAEVYSUbkAAAARXhpZgAASUkqAAgAAAAIAA8BAgARAAAAfgAAABABAgADAAAAVDEAABIBAwABAAAAAQAAABoBBQABAAAAbgAAABsBBQABAAAAdgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAkAAAAAAAAAA4YwAA6AMAADhjAADoAwAAR0JUSSB0ZXN0IGNhbWVyYQAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAkAAAADoAQAAQAAAAcAAAAAAAAA';
const CHROME = 'UklGRiwCAABXRUJQVlA4WAoAAAAgAAAACAAABgAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggPgAAALABAJ0BKgkABwABQCYlqAJ0APH0wAAA/vvvfhuQrUDjt15xA4s5Ipjf/5378NX+JR+6FNf/5lf//Mr/ZSAA';
const JPEG = { type: 'image/jpeg', name: 'cover.jpg' };
const blob = (bytes, type = 'image/webp') => new Blob([bytes], { type });
/** The clean sample grown to exactly `total` bytes with an unknown chunk, which the container allows and the check ignores. */
function sized(total) {
  const base = b64(LOSSY);
  const out = new Uint8Array(total);
  out.set(base);
  out.set(Buffer.from('PADD', 'latin1'), base.length);
  new DataView(out.buffer).setUint32(base.length + 4, total - base.length - 8, true);
  new DataView(out.buffer).setUint32(4, total - 8, true);
  return out;
}

test('a clean WebP comes back as base64 with its size, dimensions and a preview address', async () => {
  const calls = [];
  const r = await encodeCtaImage(JPEG, { encode: async (file, edge, quality) => { calls.push([file, edge, quality]); return blob(b64(LOSSY)); } });
  assert.deepEqual(r, { ok: true, base64: LOSSY, dataUrl: `data:image/webp;base64,${LOSSY}`, width: 9, height: 7, bytes: b64(LOSSY).length });
  assert.deepEqual(calls, [[JPEG, ...CTA_IMAGE_LADDER[0]]], 'the first rung is tried first, on the file as chosen');
});

test('every accepted type is re-encoded, a WebP included, and anything else is refused before encoding', async () => {
  assert.deepEqual(CTA_IMAGE_TYPES, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
  let encoded = 0;
  const encode = async () => { encoded += 1; return blob(b64(LOSSY)); };
  assert.equal((await encodeCtaImage({ type: 'image/webp' }, { encode })).ok, true);
  assert.equal(encoded, 1, 'a WebP is still drawn and encoded again, which is what drops what it carried');
  for (const type of ['image/svg+xml', 'application/pdf', '']) {
    assert.deepEqual(await encodeCtaImage({ type }, { encode }), { ok: false, problem: 'Choose a JPEG, PNG, WebP, GIF or AVIF image.' });
  }
  assert.deepEqual(await encodeCtaImage(null, { encode }), { ok: false, problem: 'Choose a JPEG, PNG, WebP, GIF or AVIF image.' });
  assert.equal(encoded, 1);
});

test('a file over the limit steps down the ladder until it fits, and says so when no rung does', async () => {
  const big = sized(CTA_IMAGE_MAX_BYTES + 2);
  const seen = [];
  const r = await encodeCtaImage(JPEG, { encode: async (_f, edge, q) => { seen.push([edge, q]); return seen.length < 3 ? blob(big) : blob(b64(LOSSY)); } });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, CTA_IMAGE_LADDER.slice(0, 3));
  const never = await encodeCtaImage(JPEG, { encode: async () => blob(big) });
  assert.deepEqual(never, { ok: false, problem: 'That image is over 400 KB even after shrinking it. Try a smaller image.' });
  const exact = await encodeCtaImage(JPEG, { encode: async () => blob(sized(CTA_IMAGE_MAX_BYTES)) });
  assert.equal(exact.ok, true, 'exactly the limit fits');
  assert.equal(exact.bytes, CTA_IMAGE_MAX_BYTES);
});

test('a browser that returns PNG when asked for WebP (Safari) is told plainly to use another browser', async () => {
  const r = await encodeCtaImage(JPEG, { encode: async () => blob(new Uint8Array(10), 'image/png') });
  assert.deepEqual(r, { ok: false, problem: 'This browser cannot save images as WebP. Use Chrome, Edge or Firefox to add an image.' });
});

test('what Chrome writes is saved without its colour profile, and camera data never survives', async () => {
  assert.equal(webpInfo(b64(CHROME)).ok, false, 'the check refuses the raw Chrome output');
  const chrome = await encodeCtaImage(JPEG, { encode: async () => blob(b64(CHROME)) });
  assert.equal(chrome.ok, true, chrome.problem);
  assert.deepEqual([chrome.width, chrome.height], [9, 7]);
  assert.equal(Buffer.from(chrome.base64, 'base64').includes('ICCP'), false);
  assert.ok(chrome.bytes < b64(CHROME).length);
  const exif = await encodeCtaImage(JPEG, { encode: async () => blob(b64(EXIF)) });
  assert.equal(exif.ok, true);
  assert.equal(Buffer.from(exif.base64, 'base64').includes('GBTI test camera'), false);
});

test('an animated result is still refused, with the server check\'s own reason', async () => {
  const animated = b64(EXIF);
  animated[20] = 0x0a;
  const r = await encodeCtaImage(JPEG, { encode: async () => blob(animated) });
  assert.deepEqual(r, { ok: false, problem: 'The re-encoded image was refused: animated images are not supported on a card.' });
});

test('an image the browser cannot draw is a plain message, not a thrown error', async () => {
  const unreadable = { ok: false, problem: 'That image could not be read. Try another file.' };
  assert.deepEqual(await encodeCtaImage(JPEG, { encode: async () => { throw new Error('decode failed'); } }), unreadable);
  assert.deepEqual(await encodeCtaImage(JPEG, { encode: async () => null }), unreadable);
  assert.deepEqual(await encodeCtaImage(JPEG, { encode: async () => blob(new Uint8Array(64)) }), unreadable, 'WebP in name only');
});
