// The size floor for content artwork (scripts/lib/media-rules.mjs, wired into scripts/check-media.mjs).
//
// WHY THIS EXISTS. On 2026-10-10 a member project went live with all four of its gallery and featured images at
// 320x200. Every check passed, because the only size rule was a 1 MB ceiling and the gallery slot is about 320
// wide, so the thumbnails looked correct. The lightbox opens the original asset at its natural size, so clicking a
// screenshot opened a postage stamp, and the committed file is the one that stays. The floor closes that.
//
// The exemptions are the part worth pinning: an `icon` is 128x128 everywhere by convention and a post's
// `coverImage` is as low as 512 on content migrated from the old WordPress site, so covering either would fail the
// build on artwork that is fine. If a later change quietly widens the rule to those roles, these tests fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_LONG_EDGE, sizedImageRefs, undersizeProblem } from '../scripts/lib/media-rules.mjs';

test('sizedImageRefs picks the featured image and every gallery entry', () => {
  const refs = sizedImageRefs({
    featuredImage: './images/featured.webp',
    gallery: [{ src: './images/one.webp', caption: 'one' }, './images/two.webp'],
  });
  assert.deepEqual(refs, [
    { role: 'featuredImage', src: './images/featured.webp' },
    { role: 'gallery[0]', src: './images/one.webp' },
    { role: 'gallery[1]', src: './images/two.webp' },
  ]);
});

test('sizedImageRefs leaves the icon and a post cover alone', () => {
  const refs = sizedImageRefs({ icon: './images/icon-128.webp', coverImage: './images/cover.webp' });
  assert.deepEqual(refs, []);
});

test('sizedImageRefs skips what it cannot or should not measure', () => {
  const refs = sizedImageRefs({
    featuredImage: 'https://cdn.example.com/hero.jpg',
    gallery: [{ src: './images/logo.svg' }, { src: '//example.com/x.png' }, { caption: 'no src' }, { src: '   ' }],
  });
  assert.deepEqual(refs, []);
});

test('sizedImageRefs returns an empty list for frontmatter with no artwork', () => {
  assert.deepEqual(sizedImageRefs({ title: 'A post' }), []);
  assert.deepEqual(sizedImageRefs(null), []);
  assert.deepEqual(sizedImageRefs('not an object'), []);
});

test('a wide image at or above the floor passes', () => {
  assert.equal(undersizeProblem({ role: 'gallery[0]', rel: 'a.webp', width: MIN_LONG_EDGE, height: 625 }), null);
  assert.equal(undersizeProblem({ role: 'featuredImage', rel: 'a.webp', width: 1253, height: 783 }), null);
});

test('a tall image passes on its long side, which is its height', () => {
  // The narrowest gallery image in the repository is 799x1145. It is not a defect: nothing is lost in a lightbox.
  assert.equal(undersizeProblem({ role: 'gallery[3]', rel: 'tall.webp', width: 799, height: 1145 }), null);
});

test('the postage stamp that caused this is rejected, with its size and path named', () => {
  const problem = undersizeProblem({ role: 'gallery[0]', rel: 'members/x/projects/y/images/shot.webp', width: 320, height: 200 });
  assert.ok(problem, 'a 320x200 gallery image must be a problem');
  assert.match(problem, /320x200/);
  assert.match(problem, /members\/x\/projects\/y\/images\/shot\.webp/);
  assert.match(problem, new RegExp(String(MIN_LONG_EDGE)));
});

test('just under the floor is still under it', () => {
  assert.ok(undersizeProblem({ role: 'featuredImage', rel: 'a.webp', width: MIN_LONG_EDGE - 1, height: 624 }));
});

test('an image that could not be measured is a problem, never a pass', () => {
  for (const dims of [{}, { width: 0, height: 0 }, { width: 1200, height: undefined }, { width: NaN, height: 800 }]) {
    assert.ok(
      undersizeProblem({ role: 'featuredImage', rel: 'broken.webp', ...dims }),
      `expected a problem for ${JSON.stringify(dims)}`,
    );
  }
});
