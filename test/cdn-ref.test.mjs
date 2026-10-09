// sow-315: which git ref the image URLs carry, and the fallback for the window where a pin 404s.
// sow-450: the host is GitHub's raw host (jsDelivr refuses this repo, over its 50 MB package limit), and the
// fallback also heals a pre-sow-450 jsDelivr URL by retrying it on the raw host.
//
// The bug sow-315 covers, measured against jsDelivr on 2026-09-07: a BRANCH ref was cached twelve hours at
// the edge and seven days in the reviewer's browser, so a replaced image kept serving the old bytes. A FULL
// 40-hex commit ref is a URL whose bytes never change.
//
// THE TRAP, and the reason for the exact-length assertions below: an ABBREVIATED sha looks pinned and is
// not (jsDelivr read `@a3190e5` as a branch). A pin to a short sha satisfies any test that only checks URL
// shape and fixes nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pinnedRef, cdnBase, setContentRef, contentRef, attachCdnFallback,
  resolveMarkdownAssets, resolveContentAsset, DEFAULT_REF, CONTENT_REPO, cdnRetryUrl,
} from '../client-ui/src/assets.mjs';

const SHA = 'a3190e581c09127494dafe5baf41cf14b2ab1a1e'; // a real commit, 40 hex
const RAW = 'https://raw.githubusercontent.com/gbti-network/gbti.network';
const at = (ref) => `${RAW}/${ref}`;
const JSD = 'https://cdn.jsdelivr.net/gh/gbti-network/gbti.network';

// The module ref is process-wide state. Every test that sets it restores it, or it leaks into
// test/markdown-images.test.mjs and test/media-picker.test.mjs, which both assert the literal `main`.
const withRef = (sha, fn) => { const prev = contentRef(); setContentRef(sha); try { return fn(); } finally { setContentRef(prev); } };

test('pinnedRef: only a full 40-hex commit pins; everything else stays on the branch', () => {
  assert.equal(pinnedRef(SHA), SHA);
  assert.equal(pinnedRef(SHA.toUpperCase()), SHA, 'an uppercase sha normalizes rather than failing');
  assert.equal(pinnedRef(`  ${SHA}  `), SHA, 'surrounding whitespace is trimmed');

  // THE TRAP. A short sha looks like a pin and is not one.
  assert.equal(pinnedRef('a3190e5'), DEFAULT_REF, 'a 7-char sha must NOT be treated as a pin');
  assert.equal(pinnedRef(SHA.slice(0, 39)), DEFAULT_REF, '39 chars is not a commit ref');
  assert.equal(pinnedRef(`${SHA}0`), DEFAULT_REF, '41 chars is not a commit ref');
  assert.equal(pinnedRef(SHA.replace('a', 'z')), DEFAULT_REF, 'non-hex is not a commit ref');

  for (const bad of [null, undefined, '', 'main', 'HEAD', 42, {}, []]) {
    assert.equal(pinnedRef(bad), DEFAULT_REF, `${JSON.stringify(bad)} must fall back to the branch`);
  }
});

test('cdnBase builds the raw-host base at the given ref, defaulting to the module ref', () => {
  assert.equal(cdnBase(CONTENT_REPO, SHA), `${at(SHA)}`);
  assert.equal(cdnBase(CONTENT_REPO, 'a3190e5'), `${at('main')}`, 'a short sha degrades, never pins');
  assert.equal(cdnBase(), `${at('main')}`, 'unset module ref is the old behaviour');
  withRef(SHA, () => assert.equal(cdnBase(), `${at(SHA)}`));
  assert.equal(cdnBase(), `${at('main')}`, 'withRef restored the module ref');
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

  assert.equal(resolveMarkdownAssets(md, item), `![](${at('main')}/${folder}/images/x.webp)`);
  assert.equal(resolveMarkdownAssets(md, item, CONTENT_REPO, SHA), `![](${at(SHA)}/${folder}/images/x.webp)`);
  withRef(SHA, () => assert.equal(resolveMarkdownAssets(md, item), `![](${at(SHA)}/${folder}/images/x.webp)`));

  // resolveContentAsset had no direct coverage at all before this change, despite being the most consumed
  // export, so the pass-through branches are pinned here too rather than only the one line that moved.
  assert.equal(resolveContentAsset('./images/x.webp', item), `${at('main')}/${folder}/images/x.webp`);
  withRef(SHA, () => {
    assert.equal(resolveContentAsset('./images/x.webp', item), `${at(SHA)}/${folder}/images/x.webp`);
    assert.equal(resolveContentAsset('images/x.webp', item), `${at(SHA)}/${folder}/images/x.webp`);
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

  const img = fakeImg(`${at(SHA)}/members/a/posts/p/images/x.webp`);
  root.fire(img);
  assert.equal(img.attrs.src, `${at('main')}/members/a/posts/p/images/x.webp`, 'a 404 on the pin retries main');

  // Once only. A genuinely missing file must fail, not loop.
  img.attrs.src = `${at(SHA)}/members/a/posts/p/images/x.webp`;
  root.fire(img);
  assert.equal(img.attrs.src, `${at(SHA)}/members/a/posts/p/images/x.webp`, 'the retry does not repeat');

  detach();
  assert.equal(root.listeners.length, 0, 'the returned detach actually removes the listener');
});

test('attachCdnFallback leaves everything that is not a pinned image alone', () => {
  const root = fakeRoot();
  attachCdnFallback(root);

  const branchImg = fakeImg(`${at('main')}/members/a/posts/p/images/x.webp`);
  root.fire(branchImg);
  assert.equal(branchImg.attrs.src, `${at('main')}/members/a/posts/p/images/x.webp`, 'already on main, nothing to do');

  const foreign = fakeImg('https://x.example/a.png');
  root.fire(foreign);
  assert.equal(foreign.attrs.src, 'https://x.example/a.png');

  const short = fakeImg(`${at('a3190e5')}/members/a/posts/p/images/x.webp`);
  root.fire(short);
  assert.equal(short.attrs.src, `${at('a3190e5')}/members/a/posts/p/images/x.webp`, 'not a pin, so not ours to retry');

  const notAnImage = fakeImg(`${at(SHA)}/members/a/posts/p/images/x.webp`, 'IFRAME');
  root.fire(notAnImage);
  assert.equal(notAnImage.attrs.src, `${at(SHA)}/members/a/posts/p/images/x.webp`);

  assert.doesNotThrow(() => attachCdnFallback(null), 'a missing root is a no-op, not a crash');
  assert.equal(typeof attachCdnFallback(null), 'function', 'and still returns a detach');
});

test('cdnBase is GitHub\'s raw host, never jsDelivr (sow-450: jsDelivr refuses this repo)', () => {
  assert.match(cdnBase(), /^https:\/\/raw\.githubusercontent\.com\/gbti-network\/gbti\.network\/main$/);
  assert.match(resolveContentAsset('./images/x.webp', 'members/a/projects/p/index.md'),
    /^https:\/\/raw\.githubusercontent\.com\/gbti-network\/gbti\.network\/main\/members\/a\/projects\/p\/images\/x\.webp$/);
  assert.doesNotMatch(resolveMarkdownAssets('![](./x.png)', 'members/a/posts/p/index.md'), /jsdelivr/);
});

test('cdnRetryUrl: a pinned raw URL and ANY jsDelivr URL for the repo retry on the raw host at main', () => {
  const tail = 'members/a/posts/p/images/x.webp';
  assert.equal(cdnRetryUrl(`${at(SHA)}/${tail}`), `${at('main')}/${tail}`);
  // Saved or cached before sow-450: jsDelivr refuses it unless it happened to be cached, so heal it.
  assert.equal(cdnRetryUrl(`${JSD}@main/${tail}`), `${at('main')}/${tail}`);
  assert.equal(cdnRetryUrl(`${JSD}@${SHA}/${tail}`), `${at('main')}/${tail}`);
  // Nothing to do: already on main, a short sha (not a pin), another repo, another host, nothing at all.
  assert.equal(cdnRetryUrl(`${at('main')}/${tail}`), '');
  assert.equal(cdnRetryUrl(`${at('a3190e5')}/${tail}`), '');
  assert.equal(cdnRetryUrl(`https://raw.githubusercontent.com/someone/else/${SHA}/${tail}`), '');
  assert.equal(cdnRetryUrl(`https://cdn.jsdelivr.net/gh/gbti-network/gbti_network@main/${tail}`), '', 'the dot is literal');
  assert.equal(cdnRetryUrl('https://x.example/a.png'), '');
  assert.equal(cdnRetryUrl(null), '');
});

test('attachCdnFallback heals a pre-sow-450 jsDelivr image on the raw host, once', () => {
  const root = fakeRoot();
  attachCdnFallback(root);
  const img = fakeImg(`${JSD}@main/members/a/posts/p/images/x.webp`);
  root.fire(img);
  assert.equal(img.attrs.src, `${at('main')}/members/a/posts/p/images/x.webp`);
  img.attrs.src = `${JSD}@main/members/a/posts/p/images/x.webp`;
  root.fire(img);
  assert.equal(img.attrs.src, `${JSD}@main/members/a/posts/p/images/x.webp`, 'the retry does not repeat');
});
