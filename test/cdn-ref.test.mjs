// sow-315: which git ref the jsDelivr asset URLs carry, and the fallback for the window where a pin 404s.
//
// The bug this covers, measured against the real CDN on 2026-09-07: a BRANCH ref answers
// `max-age=604800, s-maxage=43200`, so a replaced image kept serving the old bytes for twelve hours at the
// edge and seven days in the reviewer's browser. `@main` was still returning a cover that had been replaced
// once and then deleted from main entirely. A FULL 40-hex commit ref answers `immutable` instead.
//
// THE TRAP, and the reason for the exact-length assertions below: an ABBREVIATED sha resolves as a BRANCH
// and keeps the mutable policy. `@a3190e5` reported `x-jsd-version-type: branch`. A pin to a short sha
// looks correct, satisfies any test that only checks URL shape, and fixes nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pinnedRef, cdnBase, setContentRef, contentRef, attachCdnFallback,
  resolveMarkdownAssets, resolveContentAsset, DEFAULT_REF, CONTENT_REPO,
} from '../client-ui/src/assets.mjs';

const SHA = 'a3190e581c09127494dafe5baf41cf14b2ab1a1e'; // a real commit, 40 hex
const CDN = 'https://cdn.jsdelivr.net/gh/gbti-network/gbti.network';

// The module ref is process-wide state. Every test that sets it restores it, or it leaks into
// test/markdown-images.test.mjs and test/media-picker.test.mjs, which both assert the literal `@main`.
const withRef = (sha, fn) => { const prev = contentRef(); setContentRef(sha); try { return fn(); } finally { setContentRef(prev); } };

test('pinnedRef: only a full 40-hex commit pins; everything else stays on the branch', () => {
  assert.equal(pinnedRef(SHA), SHA);
  assert.equal(pinnedRef(SHA.toUpperCase()), SHA, 'an uppercase sha normalizes rather than failing');
  assert.equal(pinnedRef(`  ${SHA}  `), SHA, 'surrounding whitespace is trimmed');

  // THE TRAP. A short sha is a BRANCH at jsDelivr and keeps the mutable seven-day cache.
  assert.equal(pinnedRef('a3190e5'), DEFAULT_REF, 'a 7-char sha must NOT be treated as a pin');
  assert.equal(pinnedRef(SHA.slice(0, 39)), DEFAULT_REF, '39 chars is not a commit ref');
  assert.equal(pinnedRef(`${SHA}0`), DEFAULT_REF, '41 chars is not a commit ref');
  assert.equal(pinnedRef(SHA.replace('a', 'z')), DEFAULT_REF, 'non-hex is not a commit ref');

  for (const bad of [null, undefined, '', 'main', 'HEAD', 42, {}, []]) {
    assert.equal(pinnedRef(bad), DEFAULT_REF, `${JSON.stringify(bad)} must fall back to the branch`);
  }
});

test('cdnBase builds the jsDelivr base at the given ref, defaulting to the module ref', () => {
  assert.equal(cdnBase(CONTENT_REPO, SHA), `${CDN}@${SHA}`);
  assert.equal(cdnBase(CONTENT_REPO, 'a3190e5'), `${CDN}@main`, 'a short sha degrades, never pins');
  assert.equal(cdnBase(), `${CDN}@main`, 'unset module ref is the old behaviour');
  withRef(SHA, () => assert.equal(cdnBase(), `${CDN}@${SHA}`));
  assert.equal(cdnBase(), `${CDN}@main`, 'withRef restored the module ref');
});

test('setContentRef refuses a partial sha rather than pinning to a branch by accident', () => {
  withRef('a3190e5', () => assert.equal(contentRef(), DEFAULT_REF));
  withRef(SHA, () => assert.equal(contentRef(), SHA));
  assert.equal(contentRef(), DEFAULT_REF);
});

test('both resolvers carry the ref, by parameter and by module state', () => {
  const md = '![](./images/x.webp)';
  const item = 'members/atwellpub/posts/p/index.md';
  const folder = 'members/atwellpub/posts/p';

  assert.equal(resolveMarkdownAssets(md, item), `![](${CDN}@main/${folder}/images/x.webp)`);
  assert.equal(resolveMarkdownAssets(md, item, CONTENT_REPO, SHA), `![](${CDN}@${SHA}/${folder}/images/x.webp)`);
  withRef(SHA, () => assert.equal(resolveMarkdownAssets(md, item), `![](${CDN}@${SHA}/${folder}/images/x.webp)`));

  // resolveContentAsset had no direct coverage at all before this change, despite being the most consumed
  // export, so the pass-through branches are pinned here too rather than only the one line that moved.
  assert.equal(resolveContentAsset('./images/x.webp', item), `${CDN}@main/${folder}/images/x.webp`);
  withRef(SHA, () => {
    assert.equal(resolveContentAsset('./images/x.webp', item), `${CDN}@${SHA}/${folder}/images/x.webp`);
    assert.equal(resolveContentAsset('images/x.webp', item), `${CDN}@${SHA}/${folder}/images/x.webp`);
    // A pin must never rewrite something that is not a repo-relative asset.
    assert.equal(resolveContentAsset('https://x.example/a.png', item), 'https://x.example/a.png');
    assert.equal(resolveContentAsset('//cdn.example/a.png', item), 'https://cdn.example/a.png');
    assert.equal(resolveContentAsset('/_astro/a.webp', item), 'https://gbti.network/_astro/a.webp');
    assert.equal(resolveContentAsset('./images/x.webp', ''), '', 'no folder still refuses to guess');
    assert.equal(resolveContentAsset('', item), '');
  });
});

// A minimal stand-in for the DOM surface attachCdnFallback touches. The repo has no browser in `node --test`,
// and the alternative (asserting the source text of the function) would pass on a listener that never fires.
function fakeRoot() {
  const listeners = [];
  return {
    listeners,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn, capture) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    fire: (target) => listeners.filter((l) => l.type === 'error').forEach((l) => l.fn({ target })),
  };
}
const fakeImg = (src, tagName = 'IMG') => ({
  tagName, dataset: {}, attrs: { src },
  getAttribute(k) { return this.attrs[k]; },
  setAttribute(k, v) { this.attrs[k] = v; },
});

test('attachCdnFallback repoints a failed PINNED image back at the branch, once', () => {
  const root = fakeRoot();
  const detach = attachCdnFallback(root);
  assert.equal(root.listeners[0].capture, true, 'error does not bubble, so it must be captured');

  const img = fakeImg(`${CDN}@${SHA}/members/a/posts/p/images/x.webp`);
  root.fire(img);
  assert.equal(img.attrs.src, `${CDN}@main/members/a/posts/p/images/x.webp`, 'a 404 on the pin retries main');

  // Once only. A genuinely missing file must fail, not loop.
  img.attrs.src = `${CDN}@${SHA}/members/a/posts/p/images/x.webp`;
  root.fire(img);
  assert.equal(img.attrs.src, `${CDN}@${SHA}/members/a/posts/p/images/x.webp`, 'the retry does not repeat');

  detach();
  assert.equal(root.listeners.length, 0, 'the returned detach actually removes the listener');
});

test('attachCdnFallback leaves everything that is not a pinned image alone', () => {
  const root = fakeRoot();
  attachCdnFallback(root);

  const branchImg = fakeImg(`${CDN}@main/members/a/posts/p/images/x.webp`);
  root.fire(branchImg);
  assert.equal(branchImg.attrs.src, `${CDN}@main/members/a/posts/p/images/x.webp`, 'already on main, nothing to do');

  const foreign = fakeImg('https://x.example/a.png');
  root.fire(foreign);
  assert.equal(foreign.attrs.src, 'https://x.example/a.png');

  const short = fakeImg(`${CDN}@a3190e5/members/a/posts/p/images/x.webp`);
  root.fire(short);
  assert.equal(short.attrs.src, `${CDN}@a3190e5/members/a/posts/p/images/x.webp`, 'not a pin, so not ours to retry');

  const notAnImage = fakeImg(`${CDN}@${SHA}/members/a/posts/p/images/x.webp`, 'IFRAME');
  root.fire(notAnImage);
  assert.equal(notAnImage.attrs.src, `${CDN}@${SHA}/members/a/posts/p/images/x.webp`);

  assert.doesNotThrow(() => attachCdnFallback(null), 'a missing root is a no-op, not a crash');
  assert.equal(typeof attachCdnFallback(null), 'function', 'and still returns a detach');
});
