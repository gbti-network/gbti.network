// sow-304: the WorkBench Shares tab and its deep link. The tab is authoring-gated (website only, like the other
// authoring tabs), the hash carries `edit-share=<id>` for the share page's author-only Edit link, and the list
// element hands a pending id to the composer exactly once. Source-level for the element pieces (the TABS list
// lives inside the element), pure for the parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseWorkspaceTab, parseWorkspaceEditShare, planHashRoute, visibleTabs, visibleTiles } from '../client-ui/src/workspace-core.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('#tab=share resolves as a workspace tab and plans a tab switch', () => {
  assert.equal(parseWorkspaceTab('#tab=share'), 'share');
  assert.equal(parseWorkspaceTab('#tab=share&edit-share=20260610-astro'), 'share');
  assert.deepEqual(planHashRoute('#tab=share&edit-share=20260610-astro', { tab: 'overview' }), { action: 'switchTab', tab: 'share' });
});

test('edit-share=<id> parses a share id and nothing else', () => {
  assert.equal(parseWorkspaceEditShare('#tab=share&edit-share=20260610-astro-content-layer'), '20260610-astro-content-layer');
  assert.equal(parseWorkspaceEditShare('#edit-share=abc'), 'abc');
  assert.equal(parseWorkspaceEditShare('#tab=share'), null);
  assert.equal(parseWorkspaceEditShare('#edit-share=../x'), null);
  assert.equal(parseWorkspaceEditShare('#edit-share=Upper'), null);
  assert.equal(parseWorkspaceEditShare(''), null);
});

test('the Shares tab is authoring-gated: shown on the website, hidden in the extension, and so is its tile', () => {
  const src = read('client-ui/src/elements/gbti-workspace.mjs');
  const m = /\{ id: 'share', label: 'Shares'([^}]*)\}/.exec(src);
  assert.ok(m, 'the TABS entry exists');
  assert.match(m[1], /authoring: true/);
  assert.doesNotMatch(m[1], /type:/, 'no content type: the tab is a self-loading list, not a listContent tab');
  const tabs = [{ id: 'overview' }, { id: 'share', label: 'Shares', authoring: true }, { id: 'prs' }];
  assert.deepEqual(visibleTabs(tabs, true).map((t) => t.id), ['overview', 'share', 'prs']);
  assert.deepEqual(visibleTabs(tabs, false).map((t) => t.id), ['overview', 'prs']);
  const tiles = [{ nm: 'Shares', href: '#tab=share', n: 3 }, { nm: 'Pull requests', href: '#tab=prs', n: 1 }];
  assert.deepEqual(visibleTiles(tiles, tabs, false).map((t) => t.nm), ['Pull requests']);
  assert.ok(src.includes("{ nm: 'Shares', href: '#tab=share', n: c.share }"), 'the overview tile');
  assert.ok(src.includes('<gbti-share-list'), 'the tab renders the list element');
});

test('the list element emits gbti-edit-share, consumes a pending edit-id once, and only ever calls myShares', () => {
  const src = read('client-ui/src/elements/gbti-share-list.mjs');
  assert.match(src, /this\.client\.myShares\(\)/);
  assert.match(src, /emit\('gbti-edit-share'/);
  assert.match(src, /this\.removeAttribute\('edit-id'\)/);
  assert.doesNotMatch(src, /listShares\(/, 'never the community stream');
});

test('the share composer has an edit mode that re-publishes the same id and never carries encryptedBody', () => {
  const src = read('client-ui/src/elements/gbti-share-composer.mjs');
  for (const s of ['async editShare(item)', 'cancelEdit()', 'editInputFor({ share: edited', 'encRemovalFor({ share: edited', "postShare({ input, body, removeEnc, ...(owner ? { authorTarget: owner, removePaths } : {}) })", "edited: true", 'authorMoveRemovals({ share: edited, authorTarget: owner })', "this._editOwner()", 'data-author-row']) assert.ok(src.includes(s), s);
  assert.match(src, /url\.readOnly = true/);
  assert.match(src, /data-remove-link/);
  assert.match(src, /data-unpublish/);
});

test('both transports honour an edit: createdAt kept, the stale pointer dropped, the old ciphertext deleted on a public flip', () => {
  const web = read('src/lib/workbench-client.ts');
  assert.match(web, /const isEdit = !!\(input && input\.id\)/);
  assert.match(web, /const \{ encryptedBody: _stale, \.\.\.clean \} = input/);
  assert.match(web, /files\.push\(\{ path: removeEnc, content: null \}\)/);
  assert.match(web, /async myShares\(\)/);
  const npm = read('client/src/operations-social.mjs');
  assert.match(npm, /removeEnc = null/);
  assert.match(npm, /const \{ encryptedBody: _stale, \.\.\.clean \} = input/);
  assert.match(npm, /files\.push\(\{ path: removeEnc, content: null \}\)/);
  const ui = read('client-ui/src/client.mjs');
  assert.match(ui, /myShares: \(\) => request\('GET', '\/api\/my-shares'\)/);
});

// sow-317: the Network content scope reaches every member's content, and the pieces that make an edit land in place.
test('sow-317: the Network scope pins: author filter + chips in the workspace, the share list scope, the foreign-path publish', () => {
  const ws = read('client-ui/src/elements/gbti-workspace.mjs');
  for (const lit of ['data-author', 'filterByAuthor(content, this._authorFilter)', "authorOf(it)", 'scope="network"', 'Unpublished items across the network']) assert.ok(ws.includes(lit), lit);
  const sl = read('client-ui/src/elements/gbti-share-list.mjs');
  for (const lit of ["getAttribute('scope') === 'network'", 'this.client.networkShares()', 'Network shares']) assert.ok(sl.includes(lit), lit);
  const web = read('src/lib/workbench-client.ts');
  for (const lit of ['isForeignMemberPath(path, user)', "/membership/network-content?type=", "async networkShares()", "removeEnc.startsWith(`members/${owner}/_enc/`)"]) assert.ok(web.includes(lit), lit);
  const worker = read('workers/signup/index.mjs');
  for (const lit of ["'/membership/network-content'", "'/membership/network-shares'"]) assert.ok(worker.includes(lit), lit);
});

// 2026-09-11, owner report: the Shares tab had no My content / Network content switch (Network shares were
// reachable only by switching on another tab first), and the share page showed Edit to the author alone while
// every other content page shows it to the owner OR a superadmin. Three pins, one per repair.
test('the Shares tab renders the same scope switch the content tabs do, from one markup helper', () => {
  const ws = read('client-ui/src/elements/gbti-workspace.mjs');
  const shareBranch = ws.slice(ws.indexOf("if (this._tab === 'share') {"), ws.indexOf('</gbti-share-list>`', ws.indexOf("if (this._tab === 'share') {")));
  assert.ok(shareBranch.length > 0 && shareBranch.length < 900, 'the Shares tab branch was found');
  assert.match(shareBranch, /this\._canScope\(\) \? `<div class="lc-bar">\$\{this\._scopeSwitchHtml\(\)\}<\/div>` : ''/, 'superadmin-only, the same lc-bar wrapper');
  assert.match(shareBranch, /<gbti-share-list\$\{this\._scopeNow\(\) === 'house' \? ' scope="network"' : ''\}/, 'the list still follows the scope');
  assert.equal((ws.match(/this\._scopeSwitchHtml\(\)/g) || []).length, 2, 'the content tabs and the Shares tab render the one helper');
  assert.match(ws, /_scopeSwitchHtml\(\) \{[\s\S]*?data-scope="\$\{v\}"[\s\S]*?scopeBtn\('member', 'My content'\)\}\$\{scopeBtn\('house', 'Network content'\)\}/, 'the helper carries both buttons with data-scope');
  assert.match(ws, /this\.\$\$\('\[data-scope\]'\)\.forEach\(\(b\) => b\.addEventListener\('click', \(\) => this\._setScope\(b\.dataset\.scope\)\)\)/, 'one wiring serves every rendered switch');
});

test('a deep link to another member\'s share moves a superadmin to Network shares for the visit, and nobody else anywhere', () => {
  const ws = read('client-ui/src/elements/gbti-workspace.mjs');
  const listener = ws.slice(ws.indexOf("addEventListener('gbti-share-list-loaded'"), ws.indexOf('\n    });', ws.indexOf("addEventListener('gbti-share-list-loaded'")) + 8);
  assert.match(listener, /if \(id && !e\?\.detail\?\.consumed\)/, 'only an id the live list did NOT find is re-issued');
  assert.match(listener, /if \(!this\._scopeResolved\) \{ this\._editShareId = id; return; \}/, 'before the role is known the id is kept, not acted on');
  assert.match(listener, /if \(this\._canScope\(\) && this\._scopeNow\(\) === 'member'\) \{ this\._editShareId = id; this\._setScope\('house', \{ persist: false \}\); \}/, 'a superadmin in member scope moves once, unpersisted');
  assert.match(ws, /if \(this\._editShareId && !this\._canScope\(\)\) this\._editShareId = null;/, 'a member\'s kept id is dropped once the role resolves');
  assert.match(ws, /_setScope\(scope, \{ persist = true \} = \{\}\)/);
  assert.match(ws, /if \(persist\) \{ try \{ if \(typeof localStorage !== 'undefined'\) localStorage\.setItem\(WORKSPACE_SCOPE_KEY, scope\); \}/, 'the toggle still persists; the deep-link move does not');
  const sl = read('client-ui/src/elements/gbti-share-list.mjs');
  assert.match(sl, /this\.emit\('gbti-share-list-loaded', \{ count: [^,]+, consumed \}\)/, 'the list reports whether it consumed the id');
});

test('the share page reveals Edit to the owner or a superadmin through the shared helper, never its own login compare', () => {
  const page = read('src/pages/shares/[author]/[id].astro');
  assert.match(page, /import \{ wireEditAffordance \} from '\.\.\/\.\.\/\.\.\/lib\/content';/);
  assert.match(page, /wireEditAffordance\('\[data-share-edit\]', 'data-author'\)/);
  assert.match(page, /<a class="share-edit-link" data-share-edit data-author=\{d\.author\} href=\{`\/workbench\/#tab=share&edit-share=\$\{encodeURIComponent\(d\.id\)\}`\} hidden>Edit<\/a>/, 'the link, its owner stamp and the deep link are unchanged');
  assert.doesNotMatch(page, /login === String\(a\.dataset\.author/, 'the author-only compare is gone');
  const rule = read('src/lib/content-edit.mjs');
  assert.match(rule, /if \(identity\.role === 'superadmin'\) return true;/, 'the shared rule admits a superadmin');
  const helper = read('src/lib/content.ts');
  assert.match(helper, /export function wireEditAffordance\(selector: string, ownerAttr: string\)/);
  assert.match(helper, /btn\.hidden = !canEditItem\(identity, owner\)/);
});
