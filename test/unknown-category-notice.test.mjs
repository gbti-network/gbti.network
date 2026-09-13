// sow-250 (owner decision 2026-09-12): a category deep link that names a category the page does not have.
//
// Both listing pages ignored an unknown `?cat=` without a word: `/prompts/?cat=zzz` and `/articles/?cat=zzz`
// rendered every item, so a stale link (a renamed or retired category) read as a filter that matched
// everything. The feed pages already say "Nothing here matches the current filter". The owner chose to keep
// showing everything, because a reader who followed a dead link is better served by content than by an empty
// page, and to SAY so, with a one-click dismiss.
//
// Found by driving the live prompts index, not by reading it. Driven again on the built pages before shipping,
// with visibility measured per card: an unknown category kept all 25 prompts and 52 articles visible and showed
// the notice; a known one still narrowed (21 of 25, 9 of 52) with no notice; a real click on dismiss hid it and
// dropped `cat` from the URL; no horizontal overflow at 390px on either page.
//
// The page logic lives in inline scripts, so the branches are pinned by source. The one piece of real logic,
// rebuilding the URL without `cat`, is mirrored here and exercised, and a drift test holds the mirror to both
// pages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const PROMPTS = 'src/pages/prompts/index.astro';
const ARTICLES = 'src/pages/articles/index.astro';

// ---------------------------------------------------------------- the prompts page

test('prompts: an unknown category shows the notice, and a known one still filters', () => {
  const s = src(PROMPTS);
  const block = s.slice(s.indexOf('if (cat && allCatKeys[cat]) {'), s.indexOf('if (target && targetItems'));
  assert.ok(block.length > 60, 'the deep-link block moved; these assertions measure nothing');
  assert.match(block, /cats\[cat\] = true;/, 'the known-category path must still apply the filter');
  assert.match(block, /\} else if \(cat\) \{\s*showMissingCat\(\);/,
    'a present-but-unknown category must reach the notice, not fall through silently');
});

test('prompts: the notice reuses the existing chip and says exactly what happened', () => {
  const s = src(PROMPTS);
  const fn = s.slice(s.indexOf('function showMissingCat()'), s.indexOf('function showCatChip('));
  assert.ok(fn.length > 60, 'showMissingCat moved; these assertions measure nothing');
  assert.match(fn, /chipEl\.textContent = 'That category was not found\. Showing all prompts\.  '/);
  assert.match(fn, /chipEl\.setAttribute\('data-missing', ''\)/, 'the notice is marked so it is distinguishable from a filter chip');
  assert.match(fn, /hideCatChip\(\); dropCatParam\(\);/, 'dismissing must also clear the URL, or a reload brings it back');
  // textContent, never innerHTML: the category comes from the URL and is not echoed into markup at all.
  assert.ok(!fn.includes('innerHTML'), 'the notice must not write markup');
  assert.match(s, /function hideCatChip\(\) \{[^}]*chipEl\.removeAttribute\('data-missing'\)/,
    'hiding must clear the marker, or a later real filter chip inherits it');
});

// ---------------------------------------------------------------- the articles page

test('articles: an unknown category shows the notice, and a known one still filters', () => {
  const s = src(ARTICLES);
  assert.match(s, /if \(catParam && Array\.from\(pills\)\.some\(\(p\) => p\.dataset\.cat === catParam\)\) applyFilter\(catParam\);\s*else if \(catParam\) \{/,
    'the known path must still apply the filter and the unknown path must reach the notice');
  assert.match(s, /<p id="post-catmissing"[^>]* hidden>That category was not found\. Showing all articles\./,
    'the notice must ship hidden, so nothing shows unless the script decides it should');
  assert.match(s, /id="post-catmissing-clear"/);
});

// ---------------------------------------------------------------- the URL rebuild, exercised

// Mirrored from BOTH pages. The drift test below pins it, so the two cannot be edited apart from this.
const withoutCat = (search, pathname = '/prompts/', hash = '') => {
  const u = new URLSearchParams(search);
  u.delete('cat');
  const q = u.toString();
  return pathname + (q ? `?${q}` : '') + hash;
};

test('dismissing drops cat and keeps everything else in the URL', () => {
  assert.equal(withoutCat('?cat=zzz'), '/prompts/', 'a lone cat leaves a clean path, not a dangling "?"');
  assert.equal(withoutCat('?cat=zzz&tag=claude-code'), '/prompts/?tag=claude-code', 'other filters survive');
  assert.equal(withoutCat('?author=a&cat=zzz&vis=members'), '/prompts/?author=a&vis=members', 'order is kept');
  assert.equal(withoutCat('?cat=zzz', '/prompts/', '#top'), '/prompts/#top', 'the hash survives');
  assert.equal(withoutCat('?cat=a&cat=b'), '/prompts/', 'a repeated cat is removed entirely, so no second notice fires');
});

test('DRIFT: both pages rebuild the URL the way the test above exercises', () => {
  const p = src(PROMPTS);
  assert.match(p, /u\.delete\('cat'\);\s*var q = u\.toString\(\);\s*history\.replaceState\(null, '', location\.pathname \+ \(q \? '\?' \+ q : ''\) \+ location\.hash\);/);
  const a = src(ARTICLES);
  assert.match(a, /u\.delete\('cat'\);\s*const q = u\.toString\(\);\s*history\.replaceState\(null, '', location\.pathname \+ \(q \? `\?\$\{q\}` : ''\) \+ location\.hash\);/);
  // replaceState, never pushState: dismissing a notice is not a navigation the Back button should undo.
  assert.ok(!p.includes("pushState(null, '', location.pathname") && !a.includes("pushState(null, '', location.pathname"));
});
