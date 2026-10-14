// Owner, 2026-10-14: an article's left rail could not scroll far enough to show its Contents list (a sticky rail
// taller than the window never shows its bottom), and the site needs a back-to-top button bottom right on desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitStickyRail, railTopAfterScroll } from '../src/lib/pd-enhance.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** A rail with a computed sticky top and a height, in a window of a given height. */
function rig({ position = 'sticky', top = 87, height = 1137, innerHeight = 560 } = {}) {
  const props = new Map();
  const rail = {
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) },
    getBoundingClientRect: () => ({ height }),
  };
  globalThis.window = { innerHeight, scrollY: 0, addEventListener() {}, removeEventListener() {} };
  globalThis.getComputedStyle = () => ({ position, top: `${top}px` });
  globalThis.requestAnimationFrame = (f) => f();
  return { rail, props };
}
const done = () => { delete globalThis.window; delete globalThis.getComputedStyle; delete globalThis.requestAnimationFrame; };

test('a tall rail starts at its usual top, and its sticky top follows the scroll both ways', () => {
  const { rail, props } = rig();
  fitStickyRail(rail);
  assert.equal(props.get('--rail-top'), '87px', 'on a fresh page it starts where the stylesheet puts it');
  const min = 560 - 1137 - 14; // the bottom 14px above the window edge
  assert.equal(railTopAfterScroll(87, 3000, min, 87), min, 'reading down: it holds once its bottom (Contents) is in view');
  assert.equal(railTopAfterScroll(min, -300, min, 87), min + 300, 'scrolling up: it comes back down by the same distance');
  assert.equal(railTopAfterScroll(min + 300, -5000, min, 87), 87, 'and stops with its top under the header');
  assert.equal(railTopAfterScroll(-100, 0, min, 87), -100, 'no scroll, no move');
  done();
});

test('a rail that fits keeps its usual top, and a stacked phone rail is left alone', () => {
  const fits = rig({ height: 400, innerHeight: 1300 });
  fitStickyRail(fits.rail);
  assert.equal(fits.props.has('--rail-top'), false);
  const phone = rig({ position: 'static' });
  fitStickyRail(phone.rail);
  assert.equal(phone.props.has('--rail-top'), false);
  done();
});

test('Contents is the last block of the journal rail, and both rails read --rail-top', () => {
  const j = read('src/components/blog/ArticleJournal.astro');
  const rail = j.slice(j.indexOf('<aside class="art-j-rail'), j.indexOf('</aside>', j.indexOf('<aside class="art-j-rail')));
  assert.ok(rail.length > 0, 'control: the rail was found');
  assert.match(rail, /<ArticleContents toc=\{toc\} label="Contents" \/>\s*$/, 'Contents closes the rail');
  assert.ok(rail.indexOf('<ArticleContents') > rail.indexOf('rail-digest'), 'after the digest signup');
  assert.match(j, /fitStickyRail\(document\.querySelector\('\.art-j-rail'\)\)/);
  assert.match(read('src/components/blog/ArticleEditorial.astro'), /fitStickyRail\(document\.querySelector\('\.art-e-aside'\)\)/);
  const css = read('src/styles/gbti-v3-article.css');
  assert.match(css, /\.art-j-rail \{[^}]*position: sticky; top: var\(--rail-top, calc\(var\(--art-off\) \+ 14px\)\);/);
  assert.match(css, /\.art-e-aside \{ position: sticky; top: var\(--rail-top, calc\(var\(--art-off\) \+ 14px\)\);/);
  assert.doesNotMatch(css, /rail-tall/, 'the floating Contents that covered the tags is gone');
});

test('every page but a bare one carries the back-to-top button, desktop only, shown a screen down', () => {
  assert.match(read('src/layouts/BaseLayout.astro'), /\{!bare && <BackToTop \/>\}/);
  const c = read('src/components/BackToTop.astro');
  assert.match(c, /aria-label="Back to top"/);
  assert.match(c, /\.to-top \{ display: none; \}\s*@media \(hover: hover\) and \(pointer: fine\) and \(min-width: 900px\)/);
  assert.match(c, /btn\.hidden = window\.scrollY < window\.innerHeight;/);
  assert.match(c, /window\.scrollTo\(\{ top: 0,/);
});
