// sow-204: the extension stops hosting authoring, and the workspace page stays as a curation surface.
// These pin the part that is expensive to get wrong: Saved and Following must survive when authoring is off,
// because they exist nowhere else in the extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authoringEnabled, visibleTabs, resolveTab, visibleTiles, trialBanner } from '../client-ui/src/workspace-core.mjs';

// The real TABS shape, with the four Option A authoring tabs flagged. Kept here as a fixture rather than
// imported, so a change to the component's tab list fails the ELEMENT test below rather than silently
// redefining what these assertions mean.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'post', label: 'Articles', authoring: true },
  { id: 'prompt', label: 'Prompts', authoring: true },
  { id: 'project', label: 'Projects', authoring: true },
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
  for (const gone of ['post', 'prompt', 'project', 'inbox']) {
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
  assert.deepEqual(flagged, ['inbox', 'post', 'project', 'prompt'],
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

// ---------------------------------------------------------------------------------------------------------
// sow-204 increment 2 item 1: the Overview TILES.
//
// Hiding a tab without hiding its tile is worse than doing nothing: the hub keeps advertising Articles,
// Prompts and Projects, and clicking one lands on a tab resolveTab has already redirected away from. The hub
// itself is deliberately NOT flagged authoring, because it also carries Pull requests, Saved, Following,
// Earnings, Settings, Admin tools and the PR attention list, every one of which survives Option A. Removing
// the hub to fix a copy problem would remove working navigation.
// ---------------------------------------------------------------------------------------------------------

const TILE_FIXTURE = [
  { nm: 'Articles', href: '#tab=post' },
  { nm: 'Prompts', href: '#tab=prompt' },
  { nm: 'Projects', href: '#tab=project' },
  { nm: 'Pull requests', href: '#tab=prs' },
  { nm: 'Saved', href: '#tab=saved' },
  { nm: 'Settings', href: 'account.html' },
  { nm: 'Admin tools', href: 'admin.html' },
];
const TAB_FIXTURE = [
  { id: 'overview' }, { id: 'post', authoring: true }, { id: 'prompt', authoring: true },
  { id: 'project', authoring: true }, { id: 'prs' }, { id: 'inbox', authoring: true }, { id: 'saved' },
];

test('sow-204: with authoring OFF the authoring tiles go, and everything else survives in order', () => {
  const got = visibleTiles(TILE_FIXTURE, TAB_FIXTURE, false).map((t) => t.nm);
  assert.deepEqual(got, ['Pull requests', 'Saved', 'Settings', 'Admin tools'],
    'exactly the three authoring tiles are dropped, order preserved, non-tab hrefs untouched');
});

test('sow-204: a tile whose href is not a #tab= link is never filtered', () => {
  // Settings and Admin tools point at extension PAGES (account.html, admin.html) or website routes, not at a
  // workspace tab. They have no tab to be hidden with, so the filter must leave them alone in both directions.
  for (const authoring of [true, false]) {
    const got = visibleTiles(TILE_FIXTURE, TAB_FIXTURE, authoring).map((t) => t.nm);
    assert.ok(got.includes('Settings') && got.includes('Admin tools'), `page-href tiles dropped with authoring=${authoring}`);
  }
});

test('sow-204: with authoring ON nothing is removed', () => {
  assert.deepEqual(visibleTiles(TILE_FIXTURE, TAB_FIXTURE, true).map((t) => t.nm), TILE_FIXTURE.map((t) => t.nm));
});

test('sow-204: a tile pointing at a tab that does not exist is dropped', () => {
  // Deliberate: a #tab= link to an id no longer in TABS is already broken (resolveTab would redirect), so
  // keeping it would advertise a dead destination. Dropping it means a deleted tab cannot leave a live tile.
  const got = visibleTiles([...TILE_FIXTURE, { nm: 'Ghost', href: '#tab=ghost' }], TAB_FIXTURE, true).map((t) => t.nm);
  assert.ok(!got.includes('Ghost'), 'a tile for a nonexistent tab must not render');
});

test('sow-204: degenerate tile inputs do not throw', () => {
  assert.deepEqual(visibleTiles(null, TAB_FIXTURE, false), []);
  assert.deepEqual(visibleTiles(undefined, null, true), []);
  assert.deepEqual(visibleTiles([{ href: null }, {}], TAB_FIXTURE, false).length, 2, 'a tile with no href has no tab to hide with');
});

test('sow-204: the component tiles actually link to the tabs this fixture assumes', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-workspace.mjs', import.meta.url), 'utf8');
  const block = /const tiles = \[([\s\S]*?)\n {4}\];/.exec(src);
  assert.ok(block, 'could not find the tiles block; this guard is pointed at the wrong shape');

  const hrefs = [...block[1].matchAll(/href:\s*'#tab=([a-z]+)'/g)].map((m) => m[1]);
  // Control: a regex that matched nothing would make the assertion below vacuous, which is exactly how a guard
  // passes while asserting nothing.
  assert.ok(hrefs.length >= 6, `parsed ${hrefs.length} tab tiles, expected at least 6`);

  // The real linkage: every authoring-flagged tab that HAS a tile must lose that tile when authoring is off.
  // This is what stops the two lists drifting apart in a later edit.
  const tabsBlock = /const TABS = \[([\s\S]*?)\n\];/.exec(src);
  const realTabs = [...tabsBlock[1].matchAll(/\{\s*id:\s*'([a-z]+)'[^}]*\}/g)]
    .map((m) => ({ id: m[1], authoring: /authoring:\s*true/.test(m[0]) }));
  const flagged = realTabs.filter((t) => t.authoring).map((t) => t.id);
  const kept = visibleTiles(hrefs.map((id) => ({ href: `#tab=${id}` })), realTabs, false).map((t) => t.href);
  for (const id of flagged) {
    assert.ok(!kept.includes(`#tab=${id}`), `#tab=${id} is an authoring tab but its tile survives with authoring off`);
  }
  assert.ok(kept.length > 0 && kept.length < hrefs.length,
    `the filter must remove SOME tiles and keep SOME: kept ${kept.length} of ${hrefs.length}`);
});

// sow-204 increment 2 item 1, the other half of the Overview: the trial banner said "Author and stage drafts
// on your own fork now", which the authoring flag turns into a false sentence in the extension. The copy is a
// decision, so it lives in workspace-core as data and is asserted here rather than being grepped out of a
// template string in a 997-line element.

test('sow-204: the trial banner renders only for a trial member, on both hosts', () => {
  for (const authoring of [true, false]) {
    for (const m of ['active', 'expired', 'cancelled', 'none', 'banned', undefined, null, '']) {
      assert.equal(trialBanner(m, authoring), null, `membership ${JSON.stringify(m)} must not get a trial banner`);
    }
    assert.ok(trialBanner('trialing', authoring), `a trial member gets a banner with authoring=${authoring}`);
  }
});

test('sow-204: with authoring OFF the banner stops claiming this host can author', () => {
  const off = trialBanner('trialing', false);
  assert.doesNotMatch(off.body, /on your own fork now/,
    'the extension banner must not tell a member to stage drafts in a host that no longer authors');
  assert.match(off.body, /WorkBench on gbti\.network/, 'it must name the host that CAN author');
  assert.equal(off.ctaHref, 'https://gbti.network/workbench/');

  const on = trialBanner('trialing', true);
  assert.match(on.body, /on your own fork now/, 'the website and npm hosts keep the original copy unchanged');
  assert.equal(on.ctaHref, 'https://gbti.network/membership/');

  // The membership FACT is the same on both hosts; only the instruction differs. A banner that dropped the
  // paid-only rule would be a friendlier lie.
  for (const b of [on, off]) {
    assert.match(b.body, /paid membership/, 'both variants must still say publishing requires a paid membership');
    assert.equal(b.headline, 'You are on the free trial');
  }
});

test('sow-204: banner copy follows the writing conventions (no dashes, no contractions)', () => {
  for (const b of [trialBanner('trialing', true), trialBanner('trialing', false)]) {
    for (const s of [b.headline, b.body, b.ctaLabel]) {
      assert.doesNotMatch(s, /[–—]/, `em or en dash in user-facing copy: ${s}`);
      assert.doesNotMatch(s, /\b\w+'(t|s|re|ve|ll|d|m)\b/, `contraction in user-facing copy: ${s}`);
    }
  }
});
