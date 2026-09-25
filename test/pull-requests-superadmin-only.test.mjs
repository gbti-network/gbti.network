// sow-404 (owner, 2026-09-25): "Only superadmins should be interested in pull requests."
//
// The Pull requests tab, its Overview tile and count, the Overview's attention list and the extension's menu item
// show for a superadmin and nobody else, on the extension and the website WorkBench (one shared component). A
// member's session must not even READ pull requests, because a read nobody sees is the load this removes.
//
// The role is not known at first paint (it arrives with the Overview's status read), so a superadmin's
// `#tab=prs` deep link is HELD while the role is unknown rather than bounced to the Overview.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { visibleTabs, resolveTab, visibleTiles, prAttention } from '../client-ui/src/workspace-core.mjs';
import { setClient } from '../client-ui/src/index.mjs';
import { GbtiWorkspace } from '../client-ui/src/elements/gbti-workspace.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const TABS = [
  { id: 'overview' },
  { id: 'post', authoring: true },
  { id: 'prs', superadminOnly: true },
  { id: 'saved' },
];
const ids = (tabs) => tabs.map((t) => t.id);

// ---- the pure rules ----

test('the Pull requests tab shows for a superadmin and for nobody else', () => {
  assert.deepEqual(ids(visibleTabs(TABS, true, 'superadmin')), ['overview', 'post', 'prs', 'saved']);
  for (const role of ['admin', 'moderator', 'member', undefined, null, '']) {
    assert.deepEqual(ids(visibleTabs(TABS, true, role)), ['overview', 'post', 'saved'], `shown for ${String(role)}`);
  }
});

test('the role and the authoring flag hide independently', () => {
  assert.deepEqual(ids(visibleTabs(TABS, false, 'superadmin')), ['overview', 'prs', 'saved'], 'extension superadmin');
  assert.deepEqual(ids(visibleTabs(TABS, false, 'member')), ['overview', 'saved'], 'extension member');
});

test('a deep link to Pull requests is held while the role is unknown', () => {
  assert.equal(resolveTab('prs', TABS, true, undefined), 'prs');
  assert.equal(resolveTab('prs', TABS, true, null), 'prs');
});

test('once the role is known, a non-superadmin falls back and a superadmin stays', () => {
  for (const role of ['member', 'moderator', 'admin']) assert.equal(resolveTab('prs', TABS, true, role), 'overview', role);
  assert.equal(resolveTab('prs', TABS, true, 'superadmin'), 'prs');
});

test('holding for an unknown role never revives a tab the authoring flag hides', () => {
  const tabs = [{ id: 'overview' }, { id: 'x', superadminOnly: true, authoring: true }];
  assert.equal(resolveTab('x', tabs, false, undefined), 'overview');
});

test('an ordinary unknown tab still falls back while the role is unknown', () => {
  assert.equal(resolveTab('nope', TABS, true, undefined), 'overview');
});

test('the Overview tile follows the tab', () => {
  const tiles = [{ nm: 'Pull requests', href: '#tab=prs' }, { nm: 'Saved', href: '#tab=saved' }, { nm: 'Settings', href: '/account/' }];
  assert.deepEqual(visibleTiles(tiles, TABS, true, 'member').map((t) => t.nm), ['Saved', 'Settings']);
  assert.deepEqual(visibleTiles(tiles, TABS, true, 'superadmin').map((t) => t.nm), ['Pull requests', 'Saved', 'Settings']);
});

test('prAttention keeps declined and open pull requests, at most six', () => {
  const prs = [
    { number: 1, state: 'open', title: 'Open one', html_url: 'u1' },
    { number: 2, merged: true, state: 'closed', title: 'Merged' },
    { number: 3, state: 'closed', title: 'Declined one' },
    ...Array.from({ length: 8 }, (_, i) => ({ number: 10 + i, state: 'open', title: `o${i}` })),
  ];
  const rows = prAttention(prs);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.slice(0, 2).map((r) => [r.title, r.label]), [['Open one', 'Proposed'], ['Declined one', 'Declined']]);
  assert.equal(rows.some((r) => r.title === 'Merged'), false);
  assert.deepEqual(prAttention(null), []);
});

// ---- the component ----

test('the component flags the Pull requests tab superadmin-only', () => {
  assert.match(read('client-ui/src/elements/gbti-workspace.mjs'), /\{ id: 'prs', label: 'Pull requests', superadminOnly: true \}/);
});

/** Run the Overview load for a given role and record which client reads happened. */
async function overviewFor(role) {
  const calls = [];
  const client = new Proxy({}, {
    get(_, key) {
      if (key === 'then') return undefined;
      return async () => {
        calls.push(String(key));
        if (key === 'status') return { authenticated: true, role, membership: 'paid', paidTier: 'member' };
        if (key === 'listPRs') return { prs: [{ number: 5, state: 'open', title: 'Mine' }] };
        if (key === 'listContent') return { items: [] };
        return null;
      };
    },
  });
  setClient(client);
  const el = new GbtiWorkspace();
  Object.assign(el, { _tab: 'saved', _editing: null, _cache: {}, _prs: null, _overview: null });
  el.render = () => {};
  el._memberKey = async () => null; // no persistent cache in the node suite
  await el._ensureOverview();
  setClient(null);
  return { calls, el };
}

test('a member\'s Overview never reads pull requests, and shows none', async () => {
  for (const role of ['member', 'moderator', 'admin']) {
    const { calls, el } = await overviewFor(role);
    assert.ok(calls.includes('status'), 'control: the status read ran');
    assert.equal(calls.includes('listPRs'), false, `${role}: pull requests were read`);
    assert.deepEqual(el._overview.attention, []);
    assert.equal(el._overview.counts.prs, 0);
    assert.equal(el._role(), role);
  }
});

test('a superadmin\'s Overview reads them and lists the ones needing attention', async () => {
  const { calls, el } = await overviewFor('superadmin');
  assert.ok(calls.includes('listPRs'));
  assert.equal(el._overview.counts.prs, 1);
  assert.deepEqual(el._overview.attention.map((a) => a.title), ['Mine']);
});

test('the Overview markup carries the Pull requests heading for a superadmin only', async () => {
  for (const [role, want] of [['member', false], ['superadmin', true]]) {
    const { el } = await overviewFor(role);
    el.getAttribute = () => null;
    const html = el._overviewHtml();
    assert.equal(html.includes('<h3 class="ov-h3">Pull requests</h3>'), want, role);
    assert.equal(html.includes('href="#tab=prs"'), want, `${role}: the tile`);
  }
});

test('the Pull requests tab loads nothing before the role is known', async () => {
  const calls = [];
  setClient(new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : async () => { calls.push(String(k)); return null; }) }));
  const el = new GbtiWorkspace();
  Object.assign(el, { _overview: null, _cache: {}, _prs: null });
  el._swrPrs = async () => { calls.push('swrPrs'); };
  await el._ensureTab('prs');
  setClient(null);
  assert.deepEqual(calls, [], 'a pull request read happened before the role was known');
});

// ---- the extension menu ----

// sow-406 superseded the extension half the same day: the extension has no WorkBench, so no Pull requests item and no
// tab at all (a superadmin uses the website WorkBench, which keeps the superadmin-only tab above).
test('the extension has no Pull requests menu item at all', () => {
  const src = read('extension/src/shell.mjs');
  assert.equal(/key: 'prs'|tab=prs|Pull requests/.test(src), false);
});

// ---- nothing else points members at pull requests ----

test('member-facing pages and notes no longer send people to pull requests', () => {
  for (const f of ['src/pages/account.astro', 'src/pages/index.astro', 'client-ui/src/elements/gbti-discussion.mjs', 'client-ui/src/elements/gbti-content-editor.mjs']) {
    const src = read(f);
    assert.equal(/#tab=prs/.test(src), false, `${f} links the Pull requests tab`);
    assert.equal(/under Pull requests/.test(src), false, `${f} tells members to track pull requests`);
  }
  assert.equal(/opens a pull request/.test(read('src/pages/workbench.astro')), false);
});

// ---- the Profile links (owner, 2026-09-25, during this build): "The profile link should go to the members profile" ----

test('the extension Profile link opens the member\'s own public page, as the website does', () => {
  const src = read('extension/src/shell.mjs');
  assert.match(src, /href="\$\{SITE\}\/members\/" data-me-profile target="_blank" rel="noopener">Profile<\/a>/, 'the avatar menu item');
  assert.match(src, /querySelectorAll\('\[data-me-profile\]'\)\.forEach\(\(a\) => \{ a\.href = `\$\{SITE\}\/members\/\$\{encodeURIComponent\(folder\)\}\/`; \}\);/, 'filled in from the login');
  assert.equal(/href="\$\{SITE\}\/workbench\/"[^>]*>Profile</.test(src), false, 'a Profile link still opens the WorkBench');
});
