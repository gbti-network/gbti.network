// The superadmin Author picker in gbti-content-editor.mjs must not move an item nobody asked it to move.
//
// WHAT HAPPENED. On 2026-08-24 publishing the live Ryker product from the WorkBench moved index.md and its
// intro comment out of members/atwellpub/projects/ryker/ into members/gbtilabs/projects/ryker/, left the
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

// ---- the pending reassignment must travel WITH the draft (owner report 2026-08-26) ----
//
// The repair above stopped the picker moving items on its own, but the superadmin's pick still lived only in
// the DOM: Save draft, refresh, and it was gone. These assert the editor writes it down and reads it back.
// They are source-text guards on the wiring, exactly like the two above and for the same stated reason: the
// pure decisions are tested in workspace-core.test.mjs and member-drafts.test.mjs, and a correct helper that
// nothing calls would pass its own tests while the picker reverted just as before.

const client = readFileSync(new URL('../src/lib/workbench-client.ts', import.meta.url), 'utf8');

test('doDraft persists the pick, compared against the item TRUE owner rather than the rendered value', () => {
  assert.match(src, /authorTargetFor\(ownerSel\.value,\s*trueOwner\)/, 'doDraft no longer computes a pending target');
  // The baseline is load-bearing and is NOT the same one publish uses. Comparing against the rendered value
  // would store nothing when a pending pick is reloaded and saved again untouched, silently dropping it on
  // the second save; the rendered value already reflects the pending pick, so it always looks unchanged.
  assert.match(src, /const trueOwner = authorSelectValue\(\{ itemPath: this\.itemPath/, 'the true-owner baseline is gone');
  // undefined must PRESERVE (the picker does not render for a non-superadmin, nor on the extension host, and
  // neither may clear a pending move it cannot see). Only an explicit null clears.
  assert.match(src, /ownerSel \? \(authorTargetFor\([^)]*\) \?\? null\) : undefined/, 'the preserve-versus-clear contract changed');
  assert.match(src, /\.\.\.\(authorTarget !== undefined \? \{ authorTarget \} : \{\}\)/, 'doDraft stopped omitting an absent target');
});

test('the picker prefers a pending target over the path, and a consumed move is cleared', () => {
  assert.match(src, /pendingTarget: this\._pendingAuthorTarget/, 'the picker ignores the stored pending target');
  assert.match(src, /this\._pendingAuthorTarget = null;/, 'a consumed move can re-arm: publish no longer clears the pending target');
});

test('EVERY publish path forwards the stored target, not only the editor', () => {
  // Without this the feature is a lie in the most damaging direction: the editor shows the reassignment, the
  // store holds it, and publishing that draft from the Drafts list republishes it to the ORIGINAL owner and
  // reports success. A silent no-op on an action the superadmin believes they took.
  assert.match(client, /rec\.authorTarget && typeof rec\.authorTarget === 'object' \? \{ authorTarget: rec\.authorTarget \}/, 'publishDraft dropped the stored reassignment');
  assert.match(client, /async saveDraft\(\{.*authorTarget.*\}: any\)/, 'saveDraft stopped accepting a pending target');
  assert.match(client, /\.\.\.\(authorTarget !== undefined \? \{ authorTarget \} : \{\}\)/, 'saveDraft stopped preserving an absent target');
});
