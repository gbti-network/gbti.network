// Owner, 2026-10-14: an article's left rail could not scroll far enough to show its Contents list (a sticky rail
// taller than the window never shows its bottom), and the site needs a back-to-top button bottom right on desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitStickyRail, keepInView } from '../src/lib/pd-enhance.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** A rail with a computed sticky top and a height, in a window of a given height. */
function rig({ position = 'sticky', top = 87, height = 1137, innerHeight = 560 } = {}) {
  const classes = new Set();
  const rail = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); } },
    getBoundingClientRect: () => ({ height }),
  };
  globalThis.window = { innerHeight, addEventListener() {}, removeEventListener() {} };
  globalThis.getComputedStyle = () => ({ position, top: `${top}px` });
  globalThis.requestAnimationFrame = (f) => f();
  return { rail, classes };
}
const done = () => { delete globalThis.window; delete globalThis.getComputedStyle; delete globalThis.requestAnimationFrame; };

test('a rail taller than the window is marked tall, so its Contents sticks instead', () => {
  const { rail, classes } = rig();
  fitStickyRail(rail);
  assert.ok(classes.has('rail-tall'));
  done();
});

test('a rail that fits keeps sticking whole, as before, and a stacked phone rail is left alone', () => {
  const fits = rig({ height: 400, innerHeight: 1300 });
  fitStickyRail(fits.rail);
  assert.ok(!fits.classes.has('rail-tall'));
  const phone = rig({ position: 'static' });
  fitStickyRail(phone.rail);
  assert.ok(!phone.classes.has('rail-tall'));
  done();
});

test('keepInView scrolls the list, never the page, and only when the entry is out of view', () => {
  const list = { scrollHeight: 600, clientHeight: 300, scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 400 }) };
  keepInView(list, { getBoundingClientRect: () => ({ top: 450, bottom: 480 }) });
  assert.equal(list.scrollTop, 88, 'scrolled down by the overshoot plus the margin');
  keepInView(list, { getBoundingClientRect: () => ({ top: 60, bottom: 90 }) });
  assert.equal(list.scrollTop, 40, 'and back up for an entry above');
  keepInView(list, { getBoundingClientRect: () => ({ top: 200, bottom: 230 }) });
  assert.equal(list.scrollTop, 40, 'an entry in view moves nothing');
  const short = { scrollHeight: 200, clientHeight: 300, scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 300 }) };
  keepInView(short, { getBoundingClientRect: () => ({ top: 900, bottom: 930 }) });
  assert.equal(short.scrollTop, 0, 'a list that does not scroll is left alone');
});

test('both article rails are wired, and the stylesheet gives a tall rail a sticky, scrolling Contents', () => {
  assert.match(read('src/components/blog/ArticleJournal.astro'), /fitStickyRail\(document\.querySelector\('\.art-j-rail'\)\)/);
  assert.match(read('src/components/blog/ArticleEditorial.astro'), /fitStickyRail\(document\.querySelector\('\.art-e-aside'\)\)/);
  const css = read('src/styles/gbti-v3-article.css');
  assert.match(css, /\.art-e-aside\.rail-tall, \.art-j-rail\.rail-tall \{ position: relative; top: auto; align-self: stretch; \}/);
  assert.match(css, /\.art-j-rail\.rail-tall > \.art-toc \{\s*position: sticky;[^}]*max-height: calc\(100vh - var\(--art-off\) - 28px\); overflow-y: auto;/);
  assert.match(read('src/lib/pd-enhance.mjs'), /if \(on\) keepInView\(nav, on\.a\);/);
});

test('every page but a bare one carries the back-to-top button, desktop only, shown a screen down', () => {
  assert.match(read('src/layouts/BaseLayout.astro'), /\{!bare && <BackToTop \/>\}/);
  const c = read('src/components/BackToTop.astro');
  assert.match(c, /aria-label="Back to top"/);
  assert.match(c, /\.to-top \{ display: none; \}\s*@media \(hover: hover\) and \(pointer: fine\) and \(min-width: 900px\)/);
  assert.match(c, /btn\.hidden = window\.scrollY < window\.innerHeight;/);
  assert.match(c, /window\.scrollTo\(\{ top: 0,/);
});
