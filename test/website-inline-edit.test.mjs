// sow-271: the website upgrades <gbti-edit-panel>, so a member signed in ON THE WEBSITE can edit their own
// published item in place instead of meeting a control that can never appear.
//
// This suite exists because of a defect that would have shipped SILENTLY. The element was already rendered on
// every member-owned article, project and prompt page, and the fix looked like one import. But the panel's
// own gate is:
//
//     canEditInPlace(hooks, identity)  ->  identity?.username && path.startsWith(`members/${username}/`)
//
// and the website client returned `identity: { login, githubId }` with NO `username`. So the gate returned
// false for EVERYONE, the folder owner included, and it returned false quietly: no error, no console warning,
// no failed request. The feature would have been "shipped", the suite would have stayed green, and the
// control would have stayed invisible exactly as before.
//
// So these tests bind the website host's identity SHAPE to the real gate rather than asserting a string.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readHooks, canEditInPlace } from '../client-ui/src/inline.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CLIENT = read('../src/lib/workbench-client.ts');
const HOOKS = read('../src/components/EditHooks.astro');

/** The identity literal the website client's status() promises, parsed from the source. */
function websiteIdentityKeys() {
  const m = /identity:\s*\{([^}]*)\}/.exec(CLIENT);
  assert.ok(m, 'workbench-client.ts no longer returns an `identity` object literal from status()');
  return m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
}

test('the website identity satisfies the in-place edit gate for the OWNER, and only the owner', () => {
  const keys = websiteIdentityKeys();
  assert.ok(keys.includes('username'), `website identity is missing \`username\`: got [${keys.join(', ')}]`);

  // Bind the promised shape to the REAL gate. A missing key fails here for the right reason.
  const identity = Object.fromEntries(keys.map((k) => [k, k === 'githubId' ? '123' : 'alice']));
  const mine = readHooks({ gbtiPath: 'members/alice/posts/x/index.md', gbtiType: 'post' });
  const theirs = readHooks({ gbtiPath: 'members/bob/posts/y/index.md', gbtiType: 'post' });

  assert.equal(canEditInPlace(mine, identity), true, 'the folder OWNER must be able to edit in place');
  assert.equal(canEditInPlace(theirs, identity), false, 'a member must NOT edit another member folder');
  assert.equal(canEditInPlace(mine, null), false, 'a signed-out visitor must never pass the gate');
});

test('EditHooks actually imports the element, so the panel can exist on the website at all', () => {
  // The element is rendered by this component unconditionally for member-owned content. Rendering it without
  // defining it anywhere is the state this SOW is fixing, so assert the import, not just the markup.
  assert.match(HOOKS, /<gbti-edit-panel/, 'EditHooks no longer renders the element');
  assert.match(HOOKS, /elements\/gbti-edit-panel\.mjs/, 'EditHooks renders the element but never imports it');
});

test('the upgrade is gated on a real WEB session, not merely on a member signal', () => {
  // An extension-only signal carries no cookie session, so it cannot authenticate the publish call. Upgrading
  // on the signal alone would hand a member an Edit button whose save fails at the Worker.
  assert.match(HOOKS, /gbti_csrf/, 'the upgrade must require the web session cookie');
  // And nothing is imported for a visitor: the dynamic imports must sit behind the guard, never at top level.
  const topLevelElementImport = /^\s*import\s+['"][^'"]*gbti-edit-panel\.mjs['"]/m.test(HOOKS);
  assert.equal(topLevelElementImport, false, 'the element must be imported lazily, not on every page load');
});
