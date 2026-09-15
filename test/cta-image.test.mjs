// sow-337: the card image backstop (membership/cta-image.mjs). Every writer and the content check refuse a card
// image that is not a still WebP or that still carries camera, location or colour-profile data. The EXIF
// and XMP samples below are real encoder output (sharp 0.34 withExif and withXmp on a 9x7 image), so
// the test reads the chunks an encoder actually writes, not a layout guessed from the specification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webpInfo, stripWebpMetadata, bytesFromBase64, ctaImagePath, ctaImageFile, ctaImageUpload, ctaImageFileChanges, CTA_IMAGE_DIR, CTA_IMAGE_MAX_BYTES } from '../membership/cta-image.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const LOSSY = b64('UklGRjIAAABXRUJQVlA4ICYAAABwAQCdASoJAAcAAsBMJaACdAFAAAD+3FFB8XL/+QY/wa/zD5rgAA==');
const LOSSLESS = b64('UklGRh4AAABXRUJQVlA4TBEAAAAvCIABAAdQz370q/+BiOh/AAA=');
const EXIF = b64('UklGRjABAABXRUJQVlA4WAoAAAAIAAAACAAABgAAVlA4ICYAAABwAQCdASoJAAcAAsBMJaACdAFAAAD+3FFB8XL/+QY/wa/zD5rgAEVYSUbkAAAARXhpZgAASUkqAAgAAAAIAA8BAgARAAAAfgAAABABAgADAAAAVDEAABIBAwABAAAAAQAAABoBBQABAAAAbgAAABsBBQABAAAAdgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAkAAAAAAAAAA4YwAA6AMAADhjAADoAwAAR0JUSSB0ZXN0IGNhbWVyYQAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAkAAAADoAQAAQAAAAcAAAAAAAAA');
const XMP = b64('UklGRr4AAABXRUJQVlA4WAoAAAAEAAAACAAABgAAVlA4ICYAAABwAQCdASoJAAcAAsBMJaACdAFAAAD+3FFB8XL/+QY/wa/zD5rgAFhNUCByAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyI+PHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIi8+PC94OnhtcG1ldGE+');
// Chrome 148's own canvas.toBlob('image/webp') output for a 9x7 canvas: VP8X, then an sRGB ICCP chunk, then VP8.
const CHROME = b64('UklGRiwCAABXRUJQVlA4WAoAAAAgAAAACAAABgAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggPgAAALABAJ0BKgkABwABQCYlqAJ0APH0wAAA/vvvfhuQrUDjt15xA4s5Ipjf/5378NX+JR+6FNf/5lf//Mr/ZSAA');
const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=');

/** A copy with the VP8X flags byte replaced, so a chunk the header no longer announces is still in the file. */
const withFlags = (bytes, flags) => { const c = bytes.slice(); assert.equal(Buffer.from(c.slice(12, 16)).toString('latin1'), 'VP8X'); c[20] = flags; return c; };
/** A copy with one more chunk appended and the RIFF size updated. */
function withChunk(bytes, fourcc, payload = new Uint8Array(4)) {
  const out = new Uint8Array(bytes.length + 8 + payload.length + (payload.length % 2));
  out.set(bytes);
  out.set(Buffer.from(fourcc, 'latin1'), bytes.length);
  new DataView(out.buffer).setUint32(bytes.length + 4, payload.length, true);
  out.set(payload, bytes.length + 8);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

test('a still WebP with no metadata passes, with its dimensions, lossy and lossless alike', () => {
  assert.deepEqual(webpInfo(LOSSY), { ok: true, width: 9, height: 7 });
  assert.deepEqual(webpInfo(LOSSLESS), { ok: true, width: 9, height: 7 });
});

test('real EXIF, XMP and ICC samples are refused, by the header flag AND by the chunk when the flag is cleared', () => {
  assert.ok(Buffer.from(EXIF).includes('GBTI test camera'), 'the EXIF sample really carries camera data');
  for (const [name, bytes, re] of [['EXIF', EXIF, /EXIF \(camera\) data/], ['XMP', XMP, /XMP metadata/]]) {
    const flagged = webpInfo(bytes);
    assert.equal(flagged.ok, false, name);
    assert.match(flagged.problem, /announces metadata/, name);
    const hidden = webpInfo(withFlags(bytes, 0));
    assert.equal(hidden.ok, false, `${name} with the flag cleared`);
    assert.match(hidden.problem, re, name);
  }
  assert.match(webpInfo(withChunk(LOSSY, 'ICCP', new Uint8Array(12))).problem, /ICC colour profile/);
});

test('animation is refused by the header flag and by an ANIM or ANMF chunk', () => {
  assert.match(webpInfo(withFlags(EXIF, 0x02)).problem, /animated/);
  assert.match(webpInfo(withChunk(LOSSY, 'ANIM', new Uint8Array(6))).problem, /animated/);
  assert.match(webpInfo(withChunk(LOSSY, 'ANMF', new Uint8Array(16))).problem, /animated/);
});

test('not a WebP, truncated, malformed, empty, oversize and non-binary input are all refused, never thrown', () => {
  assert.match(webpInfo(PNG).problem, /not a WebP/);
  assert.match(webpInfo(LOSSY.slice(0, 30)).problem, /truncated/);
  const badStart = LOSSY.slice(); badStart[23] = 0; // the VP8 start code 9d 01 2a begins at payload byte 3
  assert.match(webpInfo(badStart).problem, /malformed/);
  const badLossless = LOSSLESS.slice(); badLossless[20] = 0; // the VP8L signature byte 0x2f
  assert.match(webpInfo(badLossless).problem, /malformed/);
  const headerOnly = LOSSY.slice(0, 12); new DataView(headerOnly.buffer).setUint32(4, 4, true);
  assert.match(webpInfo(withChunk(headerOnly, 'JUNK')).problem, /no image data/);
  const big = new Uint8Array(CTA_IMAGE_MAX_BYTES + 1); big.set(LOSSY);
  assert.match(webpInfo(big).problem, /limit is 400 KB/);
  assert.match(webpInfo(Buffer.from('x').toString()).problem, /not binary/);
  assert.match(webpInfo(null).problem, /not binary/);
});

test('bytesFromBase64 round-trips and refuses what is not base64; ctaImagePath refuses anything but a plain name', () => {
  assert.deepEqual(bytesFromBase64(Buffer.from(LOSSY).toString('base64')), LOSSY);
  for (const bad of ['', 'not base64!', 'abc', '====', null]) assert.equal(bytesFromBase64(bad), null, String(bad));
  assert.equal(ctaImageFile('stranger-in-a-strange-land'), 'stranger-in-a-strange-land.webp');
  assert.equal(ctaImagePath('stranger-in-a-strange-land.webp'), `${CTA_IMAGE_DIR}/stranger-in-a-strange-land.webp`);
  for (const bad of ['../roles.yml', 'a/b.webp', 'cover.png', 'Cover.webp', '.webp', '-x.webp', 'x.webp.png']) assert.equal(ctaImagePath(bad), null, bad);
});

test('the committed Stranger in a Strange Land cover passes the check it will be uploaded against', () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, CTA_IMAGE_DIR, 'stranger-in-a-strange-land.webp')));
  assert.deepEqual(webpInfo(bytes), { ok: true, width: 480, height: 792 });
});

// sow-337 part 2: the upload plan both writers share (the Worker route and the extension and npm writer).
test('ctaImageUpload names the file after the card and passes the bytes through; it refuses what the check refuses', () => {
  const b64 = Buffer.from(LOSSY).toString('base64');
  assert.deepEqual(ctaImageUpload({ id: 'book', imageBase64: `${b64.slice(0, 20)}\n${b64.slice(20)}` }), { ok: true, fields: { image: 'book.webp' }, upload: { path: 'house/images/ctas/book.webp', contentBase64: b64 } });
  assert.deepEqual(ctaImageUpload({ id: 'book', removeImage: true }), { ok: true, fields: { image: null }, upload: null });
  assert.deepEqual(ctaImageUpload({ id: 'book' }), { ok: true, fields: {}, upload: null });
  assert.deepEqual(ctaImageUpload({ id: 'book', removeImage: false }), { ok: true, fields: {}, upload: null });
  assert.match(ctaImageUpload({ id: 'book', imageBase64: Buffer.from(EXIF).toString('base64') }).problem, /metadata/);
  assert.match(ctaImageUpload({ id: 'book', imageBase64: Buffer.from(PNG).toString('base64') }).problem, /not a WebP/);
  assert.match(ctaImageUpload({ id: 'book', imageBase64: 'A'.repeat(Math.ceil(CTA_IMAGE_MAX_BYTES / 3) * 4 + 8) }).problem, /over the 400 KB limit/);
  assert.match(ctaImageUpload({ id: 'Bad Id', imageBase64: b64 }).problem, /kebab-case id/);
  assert.match(ctaImageUpload({ id: 'book', imageBase64: b64, removeImage: true }).problem, /not both/);
});

test('ctaImageFileChanges: the upload, plus a delete for each image no card names after the edit', () => {
  const up = { path: 'house/images/ctas/a.webp', contentBase64: 'AAAA' };
  const reg = (...images) => ({ ctas: images.map((image, i) => ({ id: `c${i}`, ...(image ? { image } : {}) })) });
  assert.deepEqual(ctaImageFileChanges(reg(), reg('a.webp'), up), [{ path: 'house/images/ctas/a.webp', contentBase64: 'AAAA' }]);
  assert.deepEqual(ctaImageFileChanges(reg('a.webp', 'b.webp'), reg(null, 'b.webp')), [{ path: 'house/images/ctas/a.webp', content: null }]);
  assert.deepEqual(ctaImageFileChanges(reg('a.webp', 'a.webp'), reg(null, 'a.webp')), [], 'still named by another card');
  assert.deepEqual(ctaImageFileChanges(reg('a.webp'), reg('a.webp'), up), [up], 'a replacement is the upload alone, never also a delete');
  assert.deepEqual(ctaImageFileChanges(reg('../roles.yml'), reg()), [], 'a malformed name in the registry is never turned into a path');
  assert.deepEqual(ctaImageFileChanges(null, null), []);
});

test('stripping removes camera data and the colour profile, clears the header flags, and keeps the picture', () => {
  const parts = (b) => { const out = []; for (let at = 12; at + 8 <= b.length;) { const n = new DataView(b.buffer, b.byteOffset).getUint32(at + 4, true); out.push([Buffer.from(b.slice(at, at + 4)).toString('latin1'), Buffer.from(b.slice(at, at + 8 + n))]); at += 8 + n + (n % 2); } return out; };
  const chunks = (b) => parts(b).map(([id]) => id);
  const vp8 = (b) => parts(b).find(([id]) => id === 'VP8 ')[1];
  assert.deepEqual(chunks(CHROME), ['VP8X', 'ICCP', 'VP8 '], 'the Chrome sample really carries a profile');
  assert.match(webpInfo(CHROME).problem, /announces metadata|colour profile/);
  for (const [name, bytes] of [['Chrome', CHROME], ['EXIF', EXIF], ['XMP', XMP]]) {
    const out = stripWebpMetadata(bytes);
    assert.deepEqual(webpInfo(out), { ok: true, width: 9, height: 7 }, name);
    assert.deepEqual(chunks(out), ['VP8X', 'VP8 '], name);
    assert.equal(out[20] & 0x2c, 0, `${name}: the header no longer announces metadata`);
    assert.equal(new DataView(out.buffer).getUint32(4, true), out.length - 8, `${name}: the RIFF size is rewritten`);
    assert.ok(vp8(out).equals(vp8(bytes)), `${name}: the image data is copied unchanged`);
  }
  assert.equal(Buffer.from(stripWebpMetadata(EXIF)).includes('GBTI test camera'), false);
  assert.ok(Buffer.from(stripWebpMetadata(LOSSY)).equals(Buffer.from(LOSSY)), 'a clean file comes back byte for byte');
});

test('stripping refuses what is not a well-formed WebP container rather than guessing', () => {
  assert.equal(stripWebpMetadata(PNG), null);
  assert.equal(stripWebpMetadata(LOSSY.slice(0, LOSSY.length - 4)), null, 'truncated');
  const lying = LOSSY.slice(); new DataView(lying.buffer).setUint32(16, 9999, true);
  assert.equal(stripWebpMetadata(lying), null, 'a chunk longer than the file');
  assert.equal(stripWebpMetadata('RIFF'), null);
  const animated = stripWebpMetadata(withFlags(EXIF, 0x0a));
  assert.match(webpInfo(animated).problem, /animated/, 'animation is not metadata: it stays, and the check still refuses it');
});
