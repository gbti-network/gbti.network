// sow-204: the extension stops hosting authoring, and the workspace page stays as a curation surface.
// These pin the part that is expensive to get wrong: Saved and Following must survive when authoring is off,
// because they exist nowhere else in the extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authoringEnabled, visibleTabs, resolveTab } from '../client-ui/src/workspace-core.mjs';

// The real TABS shape, with the four Option A authoring tabs flagged. Kept here as a fixture rather than
// imported, so a change to the component's tab list fails the ELEMENT test below rather than silently
// redefining what these assertions mean.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'post', label: 'Articles', authoring: true },
  { id: 'prompt', label: 'Prompts', authoring: true },
  { id: 'product', label: 'Products', authoring: true },
  { id: 'prs', label: 'Pull requests' },
  { id: 'inbox', label: 'Inbox', authoring: true },
  { id: 'saved', label: 'Saved' },
  { id: 'subs', label: 'Following' },
  { id: 'earnings', label: 'Earnings' },
];

test('sow-204: authoring defaults ON everywhere except the extension', () => {
  assert.equal(authoringEnabled(null, false), true, 'website: unchanged by default');
  assert.equal(authoringEnabled(undefined, false), true, 'npm CMS: unchanged by default');
  assert.equal(authoringEnabled(null, true), false, 'extension: authoring off by default');
});

test('sow-204: an explicit attribute overrides in BOTH directions', () => {
  // Both directions matter. One-way override would mean the extension could never re-enable authoring for a
  // test or a future decision, and the website could never opt out without editing this helper.
  assert.equal(authoringEnabled('off', false), false, 'website can opt out');
  assert.equal(authoringEnabled('on', true), true, 'extension can opt in');
  assert.equal(authoringEnabled('', true), true, 'a bare attribute is opt-in, not off');
  assert.equal(authoringEnabled('  OFF  ', false), false, 'case and whitespace tolerant');
});

test('sow-204: with authoring OFF, Saved and Following SURVIVE and the authoring tabs go', () => {
  const vis = visibleTabs(TABS, false).map((t) => t.id);
  // The load-bearing assertion of this whole SOW increment.
  assert.ok(vis.includes('saved'), 'Saved must survive: favorites and collections live nowhere else');
  assert.ok(vis.includes('subs'), 'Following must survive: follows live nowhere else');
  for (const gone of ['post', 'prompt', 'product', 'inbox']) {
    assert.ok(!vis.includes(gone), `${gone} is authoring and must be hidden`);
  }
  // Control: the filter must actually remove something, or this test passes on a no-op implementation.
  assert.equal(vis.length, TABS.length - 4, 'exactly the four authoring tabs are removed');
});

test('sow-204: with authoring ON nothing is removed, and order is preserved either way', () => {
  assert.deepEqual(visibleTabs(TABS, true).map((t) => t.id), TABS.map((t) => t.id));
  // Order preserved when filtering too: curation keeps its place rather than being re-sorted.
  assert.deepEqual(visibleTabs(TABS, false).map((t) => t.id),
    ['overview', 'prs', 'saved', 'subs', 'earnings']);
});

test('sow-204: a deep link to a hidden tab falls back rather than rendering an empty body', () => {
  // #tab=post is a real link the extension shell emits today, and a persisted tab can also name one.
  assert.equal(resolveTab('post', TABS, false), 'overview', 'hidden tab falls back to the first visible');
  assert.equal(resolveTab('post', TABS, true), 'post', 'still honoured when authoring is on');
  assert.equal(resolveTab('saved', TABS, false), 'saved', 'a visible tab is never redirected');
  assert.equal(resolveTab('nonsense', TABS, true), 'overview', 'an unknown tab falls back too');
});

test('sow-204: degenerate inputs do not throw', () => {
  assert.deepEqual(visibleTabs(null, false), []);
  assert.deepEqual(visibleTabs(undefined, true), []);
  assert.equal(resolveTab('post', [], false), null);
  assert.deepEqual(visibleTabs([{ id: 'a' }, null], false).map((t) => t?.id), ['a', undefined]);
});

// The fixture above is a copy of the component's TABS. A copy that drifts is worse than no copy: every
// assertion above would keep passing while describing a tab list the product no longer has. This reads the
// real source and pins the two facts the fixture depends on.
test('sow-204: the component TABS actually carry the flags this fixture assumes', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-workspace.mjs', import.meta.url), 'utf8');
  const block = /const TABS = \[([\s\S]*?)\n\];/.exec(src);
  assert.ok(block, 'could not find the TABS block; this guard is pointed at the wrong shape');

  const entries = [...block[1].matchAll(/\{\s*id:\s*'([a-z]+)'[^}]*\}/g)]
    .map((m) => ({ id: m[1], authoring: /authoring:\s*true/.test(m[0]) }));
  // Control: a regex that matched nothing would make every assertion below vacuous.
  assert.equal(entries.length, 9, `parsed ${entries.length} tabs, expected 9`);

  const flagged = entries.filter((e) => e.authoring).map((e) => e.id).sort();
  assert.deepEqual(flagged, ['inbox', 'post', 'product', 'prompt'],
    'exactly the four Option A authoring tabs are flagged');

  for (const id of ['saved', 'subs']) {
    const t = entries.find((e) => e.id === id);
    assert.ok(t, `${id} tab is gone from the component`);
    assert.equal(t.authoring, false,
      `${id} must NOT be flagged authoring: it is the curation the owner kept and it lives nowhere else in `
      + 'the extension, so flagging it would remove the feature rather than an affordance');
  }
});

// REGRESSION (2026-08-28): `_authoring()` read the attribute unguarded, and render() calls it, so a DOM-free
// instance threw `this.getAttribute is not a function`. That reddened test/ui-mount-safety.test.mjs and main
// stayed red for seven commits, because only the Unit job sees it and Deploy stayed green throughout.
// ui-mount-safety asserts render() as a whole; this asserts the specific method, so the next failure names the
// cause rather than the symptom. base.mjs falls back to `class {}` when HTMLElement is undefined, which is
// exactly the node environment this suite runs in.
test('gbti-workspace: _authoring() survives a DOM-free instance and defaults to on', async () => {
  const { GbtiWorkspace } = await import('../client-ui/src/elements/gbti-workspace.mjs');
  const el = new GbtiWorkspace();
  // Control: if the element ever gains a getAttribute in this environment, the guard below stops being the
  // thing under test and this assertion says so rather than passing for the wrong reason.
  assert.equal(typeof el.getAttribute, 'undefined',
    'this test is only meaningful on a DOM-free instance; getAttribute now exists, so re-point it');
  let got;
  assert.doesNotThrow(() => { got = el._authoring(); });
  assert.equal(got, true, 'no attribute and no chrome.runtime means the website default, authoring on');
});
