// The og:image:width / og:image:height lookup. A wrong number is worse than a missing one, so the tests that
// matter most here are the NEGATIVE ones: an image whose size we do not know must report null and the page
// must then emit no dimensions at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownImageSize } from '../src/lib/og-image-size.mjs';

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
