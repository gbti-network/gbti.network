// sow-421 (member feedback, 2026-09-28): a member clicked Edit on their share and got the composer EMPTY, "as if I'm
// just publishing"; a second try filled it. Measured cause: the composer rebuilds itself empty on any re-render, and
// two late re-renders reach it on the WorkBench after Edit has filled it (a page-wide setClient broadcast, and its own
// membership check resolving). It now declines both while it holds work, shows "Loading your share..." while an
// edit fills, and the extension's reader offers the share's author an Edit link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composerHoldsWork } from '../client-ui/src/share-post-core.mjs';
import { GbtiReader } from '../client-ui/src/elements/gbti-reader.mjs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const COMPOSER = src('client-ui/src/elements/gbti-share-composer.mjs');

test('the composer holds work while it edits a share or anything has been typed, and not otherwise', () => {
  assert.equal(composerHoldsWork({ editing: true, values: [] }), true, 'an edit, even an empty one');
  assert.equal(composerHoldsWork({ editing: false, values: ['', 'A title', undefined] }), true, 'a typed new share');
  assert.equal(composerHoldsWork({ editing: false, values: ['', '   ', null, undefined] }), false, 'an untouched composer');
  assert.equal(composerHoldsWork(), false);
});

test('the composer declines both late re-renders while it holds work', () => {
  assert.match(COMPOSER, /skipClientRender\(\) \{ return this\._holdsWork\(\); \}/, 'the page-wide setClient broadcast');
  const load = COMPOSER.slice(COMPOSER.indexOf('async _loadStatus()'), COMPOSER.indexOf('_holdsWork() {'));
  assert.ok(load.indexOf('this._holdsWork()') > -1 && load.indexOf('this._holdsWork()') < load.lastIndexOf('this.render();'),
    'its own membership check keeps the form when the answer is still the composer');
  assert.match(load, /shareComposerView\(\{ hasClient: Boolean\(this\.client\), membership: this\._membership \}\) === 'composer'/,
    'a changed answer (locked, no client) still renders');
  assert.match(COMPOSER, /const values = \['input\[type=url\]', 'input\.title', 'input\.desc', 'textarea', 'input\.tags'\]/);
});

test('an edit shows "Loading your share..." until its fields are filled, never an empty form', () => {
  assert.match(COMPOSER, /<p class="edit-loading" role="status"><span class="spin" aria-hidden="true"><\/span>Loading your share\.\.\.<\/p>/);
  const edit = COMPOSER.slice(COMPOSER.indexOf('async editShare(item)'), COMPOSER.indexOf('cancelEdit() {'));
  const on = edit.indexOf("card.classList.add('loading')");
  assert.ok(on > -1 && on < edit.indexOf('await this.client.decrypt'), 'loading before the note is fetched');
  assert.ok(edit.indexOf("card.classList.remove('loading')") > edit.indexOf("set('input[type=url]'"), 'cleared once filled');
  assert.match(COMPOSER, /\.wizard\.loading > :not\(\.edit-loading\) \{ visibility:hidden; \}/);
  assert.match(COMPOSER, /if \(h\) h\.textContent = 'Edit your share';/, 'the first step says it is an edit, not a new post');
  const wb = src('src/pages/workbench.astro');
  assert.ok(wb.indexOf('if (!dialog.open) dialog.showModal();') < wb.indexOf('await composer.editShare(item);'),
    'the WorkBench opens the dialog first, so the loading line is what shows');
  assert.match(src('client-ui/src/elements/gbti-share-list.mjs'), /this\.getAttribute\('edit-id'\) \? 'Opening your share for editing\.\.\.' : 'Loading your shares\.\.\.'/);
});

const card = (isSelf, it) => { const r = Object.create(GbtiReader.prototype); r._author = { house: false, username: 'ali', entry: null, canFollow: true, following: false, isSelf }; return r._authorCardHtml(it); };

test('the reader gives a share\'s author an Edit link straight into the share editor, and nobody else', () => {
  const share = { type: 'share', id: '20260928191738-chatgpt', author: 'ali', title: 'T' };
  assert.match(card(true, share), /<a class="follow edit" href="\/workbench\/#tab=share&edit-share=20260928191738-chatgpt">Edit share<\/a>/);
  assert.doesNotMatch(card(false, share), /edit-share=/, 'another member sees Follow, not Edit');
  assert.doesNotMatch(card(true, { type: 'share', author: 'ali' }), /edit-share=/, 'no id, no link');
  assert.match(card(true, { type: 'post', author: 'ali' }), /href="\/workbench\/#tab=post"/, 'articles unchanged');
  assert.match(src('client-ui/src/elements/gbti-reader.mjs'), /\$\{inExt \? 'Edit on gbti\.network' : 'Edit share'\}/, 'in the extension it opens the website in a new tab');
});

// sow-422 (owner, 2026-09-29): the author's role and skill chips "do not need to be included on a member share in
// the extension share page". The rest of the card stays; articles, projects and prompts keep their chips.
test('sow-422: a share\'s author card leaves out the role and skill chips; other types keep them', () => {
  const r = Object.create(GbtiReader.prototype);
  r._author = { house: false, username: 'ali', canFollow: true, following: false, isSelf: false,
    entry: { displayName: 'Ali', headline: 'Builds things', roles: ['systems-administration'], skills: ['PHP'], links: { github: 'ali' } } };
  const share = r._authorCardHtml({ type: 'share', id: 's1', author: 'ali' });
  assert.doesNotMatch(share, /class="tags"|class="tag (role|skill)"/);
  assert.match(share, /Shared by/);
  assert.match(share, /Builds things/, 'the headline stays');
  assert.match(share, /class="socials"/, 'the social icons stay');
  assert.match(share, /data-follow/, 'Follow stays');
  for (const type of ['post', 'project', 'prompt']) {
    const other = r._authorCardHtml({ type, author: 'ali' });
    assert.match(other, /<span class="tag role">/, `${type} keeps the role chips`);
    assert.match(other, /<span class="tag skill">PHP<\/span>/, `${type} keeps the skill chips`);
  }
});
