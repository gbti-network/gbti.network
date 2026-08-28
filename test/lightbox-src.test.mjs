// sow-175: the lightbox opened `currentSrc`, a mid-range responsive variant, instead of the widest candidate.
// The picking logic lives in src/lib/lightbox-src.mjs rather than inside Lightbox.astro's bundled <script>
// precisely so it can be tested here; logic left in the .astro is unreachable from node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { widestFromSrcset } from '../src/lib/lightbox-src.mjs';

test('sow-175: picks the WIDEST w candidate, not the first and not the last-by-accident', () => {
  // The real srcset Astro emits for a body image, taken from the live article page, deliberately
  // NOT in ascending order so that "returns the last one" cannot pass by coincidence.
  const srcset = [
    '/_astro/a_640.webp 640w',
    '/_astro/a_1280.webp 1280w',
    '/_astro/a_828.webp 828w',
    '/_astro/a_1080.webp 1080w',
    '/_astro/a_750.webp 750w',
  ].join(', ');
  assert.equal(widestFromSrcset(srcset), '/_astro/a_1280.webp');
});

test('sow-175: a single candidate is returned whatever its descriptor', () => {
  assert.equal(widestFromSrcset('/_astro/only.webp 640w'), '/_astro/only.webp');
  assert.equal(widestFromSrcset('/_astro/bare.webp'), '/_astro/bare.webp');
});

test('sow-175: density descriptors pick the highest, and a bare candidate counts as 1x', () => {
  assert.equal(widestFromSrcset('/a.webp, /b.webp 2x, /c.webp 3x'), '/c.webp');
  assert.equal(widestFromSrcset('/a.webp 2x, /b.webp'), '/a.webp');
});

test('sow-175: tolerates whitespace, blank entries and trailing commas', () => {
  assert.equal(widestFromSrcset('  /a.webp   640w ,, /b.webp 1280w ,  '), '/b.webp');
});

test('sow-175: returns empty for unusable input, so the caller falls back to currentSrc', () => {
  // The fallback in Lightbox.astro is `widestFromSrcset(...) || img.currentSrc || img.src`, so an empty
  // string here is load-bearing: it is what keeps a srcset-less image working exactly as before.
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(widestFromSrcset(bad), '', `expected '' for ${JSON.stringify(bad)}`);
  }
});

test('sow-175: the fix actually changes the outcome for the real page shape', () => {
  // Guards against a vacuous pass: prove the widest candidate is NOT what a mid-viewport browser
  // would have reported as currentSrc, or this whole change would be a no-op.
  const srcset = '/_astro/x_640.webp 640w, /_astro/x_1080.webp 1080w, /_astro/x_1280.webp 1280w';
  const pickedByBrowserAt1080 = '/_astro/x_1080.webp';
  const widest = widestFromSrcset(srcset);
  assert.equal(widest, '/_astro/x_1280.webp');
  assert.notEqual(widest, pickedByBrowserAt1080);
});
