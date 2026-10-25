// The invitation page renders through the SAME reshaper as the WorkBench draft preview
// (src/lib/preview-shells.mjs), so an invitation looks like the page it will publish as.
//
// WHAT WENT WRONG, AND WHAT THIS GUARDS. The invitation page shipped the project detail shell and rendered every
// listing through it, so the first real prompt invitation arrived looking like an article: a hero band instead of
// the result figure, no prompt block, no Copy, and a Contents rail a prompt page does not have. Found by the owner
// looking at the page, not by any test.
//
// The reshaper works by QUERYING elements in whatever document it is handed. That makes the coupling invisible to
// the type checker and to every existing test: rename a class in ClaimListing.astro and the reshape silently
// half-applies, leaving a page that is neither shape. So the selector list here is DERIVED from the reshaper's own
// source rather than written down, because a hand-written copy is exactly the thing that goes stale while staying
// green.
//
// A selector the reshaper INSERTS itself (the skill box and skill file holders) is not a hook the document has to
// provide, so it is excluded by looking for it in the file's own emitted HTML rather than by name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SHELL = 'src/lib/preview-shells.mjs';
const DOCUMENTS = Object.freeze({
  'the WorkBench draft preview': 'src/pages/workbench/preview.astro',
  'the invitation page': 'src/components/claim/ClaimListing.astro',
});

/** Every selector applyPreviewShell looks up in the document it is given. */
function queriedSelectors(src) {
  return [...src.matchAll(/querySelector(?:All)?\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
}

/** True when the reshaper emits this selector itself, so a document need not already carry it. */
function selfEmitted(src, sel) {
  const bare = sel.replace(/^[.#]/, '').replace(/^\[|\]$/g, '');
  return new RegExp(`(insertAdjacentHTML|createElement|className)[^\\n]*${bare}|<[a-z]+ ${bare}>`).test(src)
    || src.includes(`<div ${bare}></div>`);
}

/** The token a document must contain for this selector: a class, an id, or an attribute name. */
function documentToken(sel) {
  if (sel.startsWith('.')) return sel.slice(1);
  if (sel.startsWith('#')) return sel.slice(1);
  return sel.replace(/^\[|\]$/g, '');
}

/**
 * Does the document carry this token as a WHOLE class, id or attribute name?
 *
 * A plain `includes` was the first version of this and it was useless: renaming `pd-rail` to `pd-rail-renamed`
 * left `includes('pd-rail')` true, so the guard passed on exactly the rename it exists to catch. Caught by
 * mutation-testing the guard rather than by reading it.
 */
function carriesToken(doc, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s"'\`])${esc}([\\s"'\`=>]|$)`, 'm').test(doc);
}

test('every element the preview reshaper queries exists in both documents it reshapes', () => {
  const shell = read(SHELL);
  const selectors = queriedSelectors(shell);
  assert.ok(selectors.length >= 7, `expected the reshaper to query several elements, found ${selectors.length}`);

  const required = selectors.filter((s) => !selfEmitted(shell, s));
  assert.ok(required.length >= 6, `expected most selectors to be document hooks, found ${required.length}`);
  // The two skill holders are built by the reshaper, so neither document has to ship them.
  assert.ok(!required.includes('[data-pv-skill-box]'), 'a selector the reshaper inserts is not a document hook');

  for (const [name, path] of Object.entries(DOCUMENTS)) {
    const doc = read(path);
    for (const sel of required) {
      assert.ok(
        carriesToken(doc, documentToken(sel)),
        `${name} (${path}) is missing ${sel}, which src/lib/preview-shells.mjs looks up. `
        + 'Without it the reshape half-applies and the page is neither the project shape nor its own.',
      );
    }
  }
});

test('the invitation page applies the shell and skips the Contents rail a prompt has no room for', () => {
  const page = read('src/lib/claim-page.ts');
  assert.match(page, /import \{[^}]*applyPreviewShell[^}]*\} from '\.\/preview-shells\.mjs'/,
    'the invitation page reshapes through the shared reshaper rather than a second copy of it');
  assert.match(page, /applyPreviewShell\(doc, \{/, 'and actually calls it');
  assert.match(page, /shellHasToc\(type\)/,
    'the Contents rail is built only for a type that has one; a prompt page has none');
});

test('the reshape runs after the byline is filled, because the shell copies its contents away', () => {
  // The prompt branch copies .pd-byline's innerHTML into the header it builds and then removes the element. If the
  // reshape ran before the byline was filled it would copy an empty one, and the invitation would show no byline
  // at all. The order is load-bearing and the opposite of the draft preview's, so it is asserted rather than left
  // to a comment that a later edit can quietly violate.
  const page = read('src/lib/claim-page.ts');
  const filled = page.indexOf('showIdentity();\n    moveBylineHookInside();');
  const reshaped = page.indexOf('applyPreviewShell(doc, {');
  assert.ok(filled > 0, 'the byline is filled before the reshape');
  assert.ok(reshaped > filled, 'and the reshape follows it');
});
