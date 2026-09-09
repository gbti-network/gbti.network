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
  for (const s of ['async editShare(item)', 'cancelEdit()', 'editInputFor({ share: edited', 'encRemovalFor({ share: edited', "postShare({ input, body, removeEnc })", "edited: true"]) assert.ok(src.includes(s), s);
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
