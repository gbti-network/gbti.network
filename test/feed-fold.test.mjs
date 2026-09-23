// sow-389: on a phone the feed controls fold into one bar pinned under the site header (owner's design, 2026-09-23,
// variation C). The behaviour is driven in a browser; these pin the wiring a browser run cannot see break later:
// which pages fold, that the fold is phone-only and script-gated, and that the view buttons carry their names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const HOME = src('src/pages/index.astro');
const VIEW = src('src/components/feeds/FeedView.astro');
const ACCOUNT = src('src/pages/account.astro');
const FOLD = src('src/components/feeds/FeedFold.astro');
const CSS = src('src/styles/feed-fold.css');

/** Indexes of each needle, in the order given, failing if one is missing or out of order. */
function inOrder(text, needles, what) {
  let at = -1;
  for (const n of needles) {
    const i = text.indexOf(n, at + 1);
    assert.ok(i > at, `${what}: "${n}" is missing or out of order`);
    at = i;
  }
}

/** A selector list split on its own commas, not the ones inside :has(...) or :not(...). */
function topLevelSplit(sel) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The body of the first `@media (max-width: 620px) {` block, and everything outside it. */
function splitPhoneBlock(css) {
  const open = css.indexOf('@media (max-width: 620px) {');
  assert.ok(open >= 0, 'the phone block exists');
  let depth = 0;
  for (let i = css.indexOf('{', open); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return { inside: css.slice(open, i + 1), outside: css.slice(0, open) + css.slice(i + 1) };
  }
  throw new Error('the phone block never closes');
}

test('the homepage wraps its label row, chips and view toolbar in the fold, and nothing else', () => {
  inOrder(HOME, [
    "import FeedFold from '../components/feeds/FeedFold.astro';",
    '<FeedFold label="Everything" count={counts.all}>',
    '<div class="feed-lab" id="feed">',
    '<nav class="feed-tabs"',
    '<div class="feed-toolbar">',
    '</FeedFold>',
    '<FeedList items={feed}',
  ], 'homepage');
});

test('every /feeds/ page folds its chrome and toolbar, and the tag filter line stays outside', () => {
  inOrder(VIEW, [
    "import FeedFold from './FeedFold.astro';",
    "const foldLabel = FEED_NAV.find((t) => t.key === narrow)?.label ?? 'All';",
    '<FeedFold label={foldLabel} fold={fold}>',
    '<FeedChrome narrow={narrow} />',
    '<div class="feed-toolbar">',
    '</FeedFold>',
    'data-tag-banner',
  ], 'FeedView');
  assert.match(VIEW, /fold = true \} = Astro\.props;/, 'the fold is on unless a host turns it off');
});

test('the account page keeps its embedded feed unfolded (a bar pinned under the site header makes no sense in a card)', () => {
  assert.match(ACCOUNT, /<FeedView narrow="all"[^>]*\bfold=\{false\}/);
});

test('the fold is a real button that says whether it is open, and its styles switch on only from its script', () => {
  assert.match(FOLD, /<button type="button" class="feed-fold-bar" data-feed-fold-toggle aria-expanded="false" aria-controls="feed-fold-panel">/);
  assert.match(FOLD, /<div class="feed-fold-panel" id="feed-fold-panel" data-feed-fold-panel>/);
  assert.match(FOLD, /fold\.setAttribute\('data-fold', ''\);/);
  assert.match(FOLD, /bar\.setAttribute\('aria-expanded', String\(open\)\);/);
  assert.match(FOLD, /document\.addEventListener\('gbti:tab-changed',/, 'the homepage relabels the bar when it switches feeds in place');
  assert.match(FOLD, /\) : \(\n  <slot \/>\n\)\}/, 'fold={false} renders the controls untouched');
});

test('every fold rule is phone-only and hangs off [data-fold]; above 620px only the bar and the names are hidden', () => {
  const { inside, outside } = splitPhoneBlock(CSS);
  const rulesOutside = outside.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert.equal(rulesOutside, '.feed-fold-bar { display: none; }\n\n.vt-lbl { display: none; }');
  assert.match(inside, /\.feed-fold\[data-fold\] \{\n\s*position: sticky; top: calc\(var\(--head-h\) \+ 1px\);/, 'pinned under the header, by the shared header-height token');
  assert.match(inside, /\.feed-fold\[data-fold\]:not\(\.is-open\) \.feed-fold-panel \{ display: none; \}/);
  const selectors = inside.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g).slice(1).map((s) => s.trim());
  for (const sel of selectors) {
    for (const one of topLevelSplit(sel)) assert.match(one, /\[data-fold\]/, `"${one.trim()}" must hang off [data-fold]`);
  }
});

test('each view button carries its name as text, the same word as its aria-label', () => {
  for (const [name, text] of [['homepage', HOME], ['FeedView', VIEW]]) {
    const buttons = [...text.matchAll(/<button type="button" class="vt-btn[^"]*" data-feedview-density="[a-z]+"[^>]*aria-label="([A-Za-z]+)"[^>]*>([\s\S]*?)<\/button>/g)];
    assert.equal(buttons.length, 3, `${name}: three view buttons`);
    for (const [, label, inner] of buttons) assert.ok(inner.endsWith(`<span class="vt-lbl">${label}</span>`), `${name}: ${label}`);
  }
});
