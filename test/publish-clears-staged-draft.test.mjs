// sow-326: four owner-reported WorkBench defects that all trace to ONE omission, plus the two hops that lost
// the author note. Reported 2026-09-12, editing one article as a superadmin from a second account:
//
//   "This staged draft is ahead of the live edge" never goes away, no matter how many times I publish.
//   The article will not switch layout no matter what.
//   The author note disappears every time I refresh.
//
// THE OMISSION: publish() swept its staged IMAGES and never deleted the KV draft record. The record outlived
// its own publication, so every later open of the item read the stale draft back instead of the file that had
// just been committed: the banner stayed, the layout and the note reverted, and because the record is keyed by
// ACCOUNT with no author in it, two superadmins editing one article overwrote each other.
//
// Source-pinned where the module cannot load in node (workbench-client.ts is TypeScript, the element needs a
// DOM), behavioural where it can. This is the same idiom as the drift tests in test/article-page.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const CLIENT = 'src/lib/workbench-client.ts';
const EDITOR = 'client-ui/src/elements/gbti-content-editor.mjs';
const WORKSPACE = 'client-ui/src/elements/gbti-workspace.mjs';

// ---------------------------------------------------------------- the record dies on publish

test('publish deletes the KV draft record, which nothing used to do', () => {
  const s = src(CLIENT);
  const i = s.indexOf('op: \'delete\', type, slug: staleSlug');
  assert.ok(i > 0, 'publish() no longer deletes the published draft record, so the banner becomes immortal again');
});

test('the draft delete runs AFTER the author POST, never before it', () => {
  const s = src(CLIENT);
  const post = s.indexOf("const res = await workerPost('/membership/author'");
  const del = s.indexOf("op: 'delete', type, slug: staleSlug");
  assert.ok(post > 0 && del > post,
    'a delete before the PR is opened loses the draft when the publish fails, the rule the image cleanup already states');
});

test('the draft delete cannot fail the publish it follows', () => {
  const s = src(CLIENT);
  const line = s.split('\n').find((l) => l.includes("op: 'delete', type, slug: staleSlug"));
  assert.match(line, /try \{.*\} catch/, 'an uncaught throw here reports a SUCCESSFUL publish to the author as a failure');
});

test('a rename sweeps the pre-rename slug too, because both tokens are walked', () => {
  const s = src(CLIENT);
  const del = s.slice(s.indexOf('for (const token of itemTokens)'), s.indexOf('    return {', s.indexOf('for (const token of itemTokens)')));
  assert.ok(del.includes('itemTokens'), 'the cleanup must iterate itemTokens, which carries the old slug on a rename');
  assert.ok(del.includes('slice(String(type).length + 1)'), 'the slug is taken off the <type>:<slug> token');
});

test('the npm and extension host clears the record too, or it resurrects what the website deleted', () => {
  const s = src('client/src/operations-publish.mjs');
  assert.ok(s.includes('workerDeleteDraft'), 'the hosted publish path must drop the staged record like the website does');
  const call = s.indexOf('await workerDeleteDraft');
  const author = s.indexOf('const r = await hostedAuthor(');
  assert.ok(author > 0 && call > author, 'same ordering rule: after the author call, never before');
});

// ---------------------------------------------------------------- the flag clears in-session

test('a successful publish clears the staged flag on the editor', () => {
  const s = src(EDITOR);
  const pub = s.slice(s.indexOf('async doPublish()'), s.indexOf('} catch (err) {', s.indexOf('async doPublish()')));
  assert.ok(pub.includes('this.staged = false'),
    'load() is the only other writer, so without this the banner returns on the next repaint of an editor that just published');
});

test('the workspace clears ITS copy of staged, which is re-fed into load on every render', () => {
  const s = src(WORKSPACE);
  const line = s.split('\n').find((l) => l.includes("addEventListener('gbti-published'"));
  assert.match(line, /_editing\.staged = false/,
    'line ~641 re-feeds { staged: e.staged } into load(), so clearing only the editor would be undone');
});

// ---------------------------------------------------------------- the banner says only what it knows

// The COPY is what is under test, so these read the banner line itself. Scoping to the line is deliberate
// rather than lazy: a whole-file grep for the retired phrase trips on the comment that explains why it was
// retired (it did, on the first run), and the no-dash rule exempts prose in code comments.
const bannerLine = () => {
  const line = src(EDITOR).split('\n').find((l) => l.includes('class="pubinfo warn" id="pubbanner"'));
  assert.ok(line, 'the staged banner markup moved; these assertions no longer measure anything');
  return line;
};

test('the banner no longer claims the draft is AHEAD of the live edge', () => {
  const line = bannerLine();
  assert.ok(!line.includes('ahead of the live edge'),
    'the editor holds no copy of the committed file, so it cannot know the direction; a staged record is often BEHIND main');
  assert.ok(line.includes('You have unpublished changes saved in this editor'), 'the honest replacement copy');
});

test('no em dash in the banner copy, per the writing conventions', () => {
  assert.ok(!bannerLine().includes('\u2014'), 'an em dash reached a user-facing string');
});

// ---------------------------------------------------------------- the author note travels

test('the saved author note is carried from the store into the editor', () => {
  const w = src(WORKSPACE);
  assert.match(w, /authorNote: typeof full\.authorNote === 'string'/, '_openDraft used to drop the field readDraft returns');
  const load = w.split('\n').find((l) => l.includes('ed.load(e.type, e.frontmatter'));
  assert.match(load, /authorNote: e\.authorNote/, 'the second hop dropped it too, so both have to carry it');
  const e = src(EDITOR);
  assert.match(e, /load\(type, input, body, path, \{[^}]*authorNote = null/s, 'load must accept it');
  assert.match(e, /this\.preset = \{ input: input \|\| \{\}, body: body \|\| '', authorNote:/, 'and fold it into the preset it reads back');
});

test('an EMPTY stored note stays empty, because clearing it is deliberate', () => {
  const s = src(EDITOR);
  assert.ok(s.includes("typeof this.preset?.authorNote === 'string' ? this.preset.authorNote : null"),
    'testing the TYPE is what distinguishes an explicit clear ("") from an absent note (fall back and read the live one)');
});

test('the note fallback reads the ITEM owner folder, not the caller folder', () => {
  const e = src(EDITOR);
  const from = e.indexOf('const staged = typeof this.preset?.authorNote');
  const block = e.slice(from, e.indexOf('.catch(() => {});', from));
  assert.ok(from > 0 && block.length > 200, 'the prefill block moved; this assertion measures nothing');
  assert.match(block, /authorSelectValue\(\{ itemPath: this\.itemPath/, 'the owner comes off the item path');
  assert.match(block, /getComment\?\.\(\{ id: `intro-\$\{introSlug\}`, \.\.\.\(noteAuthor/,
    'a superadmin editing another member article got a not-found and an empty box');
});

test('getComment defaults to the caller and only widens when asked', () => {
  const s = src(CLIENT);
  assert.match(s, /async function getCommentLocal\(id: string, author\?: string\)/, 'author is optional');
  assert.match(s, /const folder = \/\^\[a-z0-9\]\[a-z0-9-\]\*\$\/\.test\(String\(author \|\| ''\)\) \? String\(author\) : user;/,
    'a malformed author must fall back to the caller, never build a path out of arbitrary input');
  assert.ok(s.includes('getComment({ id, author }: any)'), 'the public method passes it through');
});

// ---------------------------------------------------------------- a re-render stops reverting a live choice

test('an element can decline a client-broadcast re-render', () => {
  const s = src('client-ui/src/base.mjs');
  assert.match(s, /this\._onClient = \(\) => this\.isConnected && this\.skipClientRender\?\.\(\) !== true && this\.render\?\.\(\)/,
    'the setClient fan-out reaches the editor directly, bypassing the workspace own !this._editing guards');
});

test('the editor declines only while dirty, so the client-ready load race still works', () => {
  const s = src(EDITOR);
  assert.match(s, /skipClientRender\(\) \{ return this\._dirty === true; \}/,
    'a wider guard would strand a one-shot connectedCallback load on "Loading..."');
});

test('the illustrated pickers write the preset, not only the DOM', () => {
  const s = src(EDITOR);
  const gs = s.slice(s.indexOf("this.$$('[data-gscards]')"), s.indexOf("const be = this.$('#body')"));
  assert.match(gs, /this\.preset\.input\[gsKey\] = btn\.dataset\.gs/,
    'render() rebuilds every control from the preset, so a DOM-only choice was reverted by any repaint');
  const sw = s.slice(s.indexOf("this.$$('[data-swatches]')"), s.indexOf("this.$$('[data-gscards]')"));
  assert.match(sw, /this\.preset\.input\[hidden\.dataset\.key\] = btn\.dataset\.preset/, 'the banner swatches had the same bug');
});
