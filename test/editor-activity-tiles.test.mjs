// sow-232: the editor's Activity card shows only what is real: Discussions, Live revisions, Contributions. No
// tile renders a dash as a placeholder (an em-dash is banned in user-facing strings anyway), Contributions
// counts the credited contributors on the item, and Live revisions comes from client.itemStats(), which the
// website client and the npm host now implement. Source-level guards plus the two client wirings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const editor = read('client-ui/src/elements/gbti-content-editor.mjs');

test('STAT_DEFS is exactly the three real tiles, in order', () => {
  const block = editor.slice(editor.indexOf('const STAT_DEFS = ['), editor.indexOf('];', editor.indexOf('const STAT_DEFS = [')));
  const keys = [...block.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['discussions', 'revisions', 'contributions']);
  assert.ok(block.includes("label: 'Live revisions'") && block.includes("label: 'Contributions'"));
  assert.ok(!block.includes('Draft revisions') && !block.includes('Referrals'), 'the two unbacked tiles are gone');
});

test('no tile renders a dash placeholder and the footnote no longer promises a stats backend', () => {
  const tile = editor.slice(editor.indexOf('<div class="rail-stats">'), editor.indexOf('rail-foot-note'));
  assert.ok(!tile.includes('—') && !tile.includes('–'), 'no em or en dash in the tile template');
  assert.ok(tile.includes('data-statn="${s.key}">…<'), 'a tile shows an ellipsis while it loads');
  assert.ok(editor.includes('Live once published.'), 'the footnote');
  assert.ok(!editor.includes('stats backend'), 'the old promise is gone');
});

test('Contributions is the credited contributors count; Live revisions comes from itemStats with n/a on failure', () => {
  const start = editor.indexOf('const setStat = ');
  const loader = editor.slice(start, editor.indexOf('// SOW-062 P3: the rich cover-image', start));
  assert.ok(start > 0 && loader.length > 200, 'the loader block was found');
  assert.match(loader, /this\.preset\?\.input\?\.contributors/);
  assert.match(loader, /setStat\('contributions', Array\.isArray\(credited\) \? credited\.length : 0\)/);
  assert.match(loader, /typeof this\.client\?\.itemStats === 'function'/);
  assert.match(loader, /setStat\('revisions', st\.revisions\)/);
  assert.match(loader, /failStat\('revisions'/);
  assert.match(loader, /el\.textContent = 'n\/a'; el\.title = why/);
});

test('the website client and the client-ui transport both carry itemStats', () => {
  const web = read('src/lib/workbench-client.ts');
  assert.match(web, /async itemStats\(\{ path \}/);
  assert.match(web, /\/membership\/revisions\?path=/);
  const ui = read('client-ui/src/client.mjs');
  assert.match(ui, /itemStats: \(\{ path \}\) => request\('GET', `\/api\/item-stats\$\{qs\(\{ path \}\)\}`\)/);
});
