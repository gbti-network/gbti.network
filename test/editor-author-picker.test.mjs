// The superadmin Author picker in gbti-content-editor.mjs must not move an item nobody asked it to move.
//
// WHAT HAPPENED. On 2026-08-24 publishing the live Ryker product from the WorkBench moved index.md and its
// intro comment out of members/atwellpub/products/ryker/ into members/gbtilabs/products/ryker/, left the
// co-located images/ behind, and stopped the Astro build on main. The repository was repaired in 36a1567d;
// the client-side cause was recorded as needing its own fix and was not fixed, and it recurred.
//
// The picker marked an option `selected` only when the loaded frontmatter's `author` matched a members-index
// username. `author` is NOT a form field, so gather() drops it and every draft the editor saves round-trips
// back without one. With nothing selected a browser selects the FIRST option, which is
// "House / GBTI Network", and doPublish sent that as a deliberate reassignment. Since sow-195 the house scope
// resolves to the literal members/gbtilabs folder and the literal gbtilabs author.
//
// The decisions now live in two pure functions (tested in workspace-core.test.mjs, including the mutations
// that reproduce the defect). THIS file asserts the editor still ASKS them, because the failure was in the
// markup: a pure function nothing calls would pass its own tests while the picker reverted exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client-ui/src/elements/gbti-content-editor.mjs', import.meta.url), 'utf8');

test('the starting selection comes from the item path, not from the frontmatter author', () => {
  assert.match(src, /authorSelectValue\(\{\s*itemPath:\s*this\.itemPath/, 'the picker no longer derives its owner from the path');
  // The old derivation, which is what produced the empty selection. Its return would be a silent move.
  assert.doesNotMatch(src, /curAuthorUsername/, 'the frontmatter-author derivation is back');
  assert.doesNotMatch(src, /curAuthorScope/, 'the itemScope-derived author scope is back');
});

test('publish sends a reassignment only through authorTargetFor, with the rendered value to compare against', () => {
  const call = /authorTargetFor\(\s*this\.\$\('#ownerSelect'\)\?\.value,\s*this\._ownerSelInitial\s*\)/;
  assert.match(src, call, 'doPublish no longer compares the pick against what was rendered');
  // The unconditional construction that shipped the accidental default as a deliberate reassignment.
  assert.doesNotMatch(src, /ownerSel === 'house' \? \{ scope: 'house' \}/, 'the unconditional authorTarget is back');
});

test('an owner the picker cannot resolve renders an inert first option, never a real target', () => {
  // The first option in the list is the one a browser falls back to. It must be a no-op, because the first
  // REAL option is House / GBTI Network, which moves the item.
  assert.match(src, /known \? '' : opt\('', 'Keep the current author', true\)/, 'the inert placeholder is gone');
  assert.match(src, /this\._ownerSelInitial = known \? ownerSelValue : ''/, 'the rendered value is no longer recorded');
  // And it is reset per render, so a value left over from a previously edited item cannot read as "unchanged".
  assert.match(src, /this\._ownerSelInitial = '';/, 'the per-render reset is gone');
});

test('after a publish the owner is read back off the returned path, not from a hardcoded literal', () => {
  // 'gbti' names no member, so it matched no option: after one accidental house publish the picker could
  // never resolve the owner again and re-defaulted to House on every later render. That is the "still".
  assert.doesNotMatch(src, /scope === 'house' \? 'gbti' :/, "the stale 'gbti' literal is back");
  assert.match(src, /const owner = authorSelectValue\(\{ itemPath: res\.path \}\)/, 'the post-publish owner no longer follows the item to where it landed');
  // And it must not do so by importing the network owner's name from client/src, which drags content-ops and
  // its dependencies into the page bundle: measured at +535 KB on gbti-ui.js, for one string.
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/\.\.\/client\/src\//, 'the editor now imports client/src, which bloats the page bundle');
});
