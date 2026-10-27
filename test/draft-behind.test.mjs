// sow-482: a saved draft that falls behind the published article. On 2026-10-26 a WorkBench tab opened before the
// podcast block was added published over it (#874), and a draft saved before a later publish opened as the item
// without the block, the newer opening line or the right layout. A draft now remembers the published version it
// started from, the editor says when the article has moved past it, and a publish refuses to write over a version it
// never saw unless the author chooses "Publish anyway".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { contentBase, baseOf, draftBehind, publishBaseProblem } from '../client/src/content-base.mjs';
import { checkDraftBehind, openPublishedInto, behindMessage, staleMessage, staleDraftRowMessage, forceConfirmMessage, itemNoun, BEHIND_BASE } from '../client-ui/src/draft-behind.mjs';
import { applyDraftPut, normalizeDrafts, listDraftRecords } from '../membership/member-drafts.mjs';
import { draftRecordForEditor } from '../src/lib/workbench-client-core.mjs';
import { changeLabel } from '../client-ui/src/publish-diff.mjs';
import { followPublishedItem } from '../client-ui/src/workspace-core.mjs';
import { contentEditorSource } from './lib/content-editor-source.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';

// ---------------------------------------------------------------- the version marker

test('contentBase is the first 16 hex characters of SHA-256, stable and sensitive', async () => {
  assert.equal(await contentBase(''), 'e3b0c44298fc1c14', 'the published SHA-256 of the empty string, truncated');
  const text = '---\ntitle: Crystal Ball\nupdatedAt: 2026-10-27T02:00:00Z\n---\nOpening line.\n';
  const one = await contentBase(text);
  assert.match(one, /^[0-9a-f]{16}$/);
  assert.equal(await contentBase(text), one, 'the same file gives the same marker');
  assert.notEqual(await contentBase(text.replace('02:00', '02:01')), one, 'a publish restamps updatedAt, so any publish moves it');
  assert.equal(await contentBase(null), await contentBase(''), 'no text reads as empty rather than throwing');
});

test('baseOf accepts only a well-formed marker', () => {
  assert.equal(baseOf(A), A);
  for (const bad of [null, undefined, '', 'AAAAAAAAAAAAAAAA', 'aaaa', `${A}a`, 42, {}]) assert.equal(baseOf(bad), null, String(bad));
});

// ---------------------------------------------------------------- is the draft behind?

test('draftBehind compares markers when both are known', () => {
  assert.equal(draftBehind({ base: A, committedBase: A }), false, 'the draft started from what is published');
  assert.equal(draftBehind({ base: A, committedBase: B }), true, 'the article was published again since');
  // The dates are not consulted when the markers decide: a re-save moves savedAt past the article's change.
  assert.equal(draftBehind({ base: A, committedBase: B, savedAt: '2026-10-28T00:00:00Z', lastAt: '2026-10-27T02:00:00Z' }), true,
    'a draft saved after the change but started before it is still behind');
});

test('draftBehind falls back to dates for a draft saved before markers existed', () => {
  const at = { savedAt: '2026-10-26T21:42:00Z', lastAt: '2026-10-27T02:00:00Z' };
  assert.equal(draftBehind({ committedBase: B, ...at }), true, 'the Crystal Ball case: published at 02:00 after a 21:42 save');
  assert.equal(draftBehind({ committedBase: B, savedAt: at.lastAt, lastAt: at.savedAt }), false, 'saved after the last change');
  assert.equal(draftBehind({ committedBase: B, lastAt: at.lastAt }), false, 'no save time: nothing is claimed');
  assert.equal(draftBehind({ base: A, savedAt: at.savedAt, lastAt: at.lastAt }), true, 'the committed read failed, the dates still decide');
});

test('draftBehind: an item never published has nothing to fall behind', () => {
  assert.equal(draftBehind({ base: A }), false);
  assert.equal(draftBehind({ savedAt: '2026-10-26T21:42:00Z' }), false);
  assert.equal(draftBehind({}), false);
  assert.equal(draftBehind(), false);
});

// ---------------------------------------------------------------- the publish check

test('publishBaseProblem refuses a version the editor never saw, and only that', () => {
  assert.equal(publishBaseProblem({ bases: [A], committedBase: A }), null);
  assert.match(publishBaseProblem({ bases: [A], committedBase: B }), /changed after this edit began/);
  assert.equal(publishBaseProblem({ bases: [B, A], committedBase: A }), null, 'just after its own publish, main can still show the older one');
  assert.equal(publishBaseProblem({ bases: [B, A], committedBase: B }), null, 'or the one it committed');
  assert.match(publishBaseProblem({ bases: [B, A], committedBase: C }), /Publishing now would replace those changes/);
  assert.equal(publishBaseProblem({ bases: A, committedBase: A }), null, 'a single base is accepted as well as a list');
});

test('publishBaseProblem: "Publish anyway", an editor with no base, and an unreadable file are not checked', () => {
  assert.equal(publishBaseProblem({ bases: [A], committedBase: B, force: true }), null, 'the author chose to replace it');
  assert.equal(publishBaseProblem({ bases: [], committedBase: B }), null, 'a new item, or an older client');
  assert.equal(publishBaseProblem({ committedBase: B }), null);
  assert.equal(publishBaseProblem({ bases: ['not-a-marker'], committedBase: B }), null, 'a malformed base is no base');
  assert.equal(publishBaseProblem({ bases: [A], committedBase: null }), null, 'nothing on main to compare with');
});

// ---------------------------------------------------------------- the draft store keeps it

const put = (s, over, at) => applyDraftPut(s, { type: 'post', slug: 'crystal-ball', path: 'members/a/posts/crystal-ball/index.md', frontmatter: { title: 'X' }, body: 'b', ...over }, { now: () => at });

test('applyDraftPut stores the base, keeps it when a save sends none, clears it on an explicit null', () => {
  let s = put(normalizeDrafts(null), { base: A }, '2026-10-26T21:00:00Z');
  assert.equal(listDraftRecords(s)[0].base, A);
  s = put(s, {}, '2026-10-26T21:42:00Z');
  assert.equal(listDraftRecords(s)[0].base, A, 'the WorkBench preview saves without one, and must not erase it');
  s = put(s, { base: B }, '2026-10-26T22:00:00Z');
  assert.equal(listDraftRecords(s)[0].base, B);
  s = put(s, { base: null }, '2026-10-26T23:00:00Z');
  assert.equal('base' in listDraftRecords(s)[0], false, 'an explicit null clears it');
});

test('applyDraftPut drops a malformed base rather than refusing the save', () => {
  const s = put(normalizeDrafts(null), { base: '<script>' }, '2026-10-26T21:00:00Z');
  assert.equal('base' in listDraftRecords(s)[0], false);
  assert.equal(listDraftRecords(s)[0].body, 'b', 'the draft itself was still saved');
});

test('draftRecordForEditor carries the base and the save time to the editor', () => {
  const rec = draftRecordForEditor({ type: 'post', slug: 's', frontmatter: {}, body: '', base: A, updatedAt: '2026-10-26T21:42:00Z' }, 'alice');
  assert.equal(rec.base, A);
  assert.equal(rec.savedAt, '2026-10-26T21:42:00Z');
  const old = draftRecordForEditor({ type: 'post', slug: 's', frontmatter: {}, body: '' }, 'alice');
  assert.equal(old.base, null);
  assert.equal(old.savedAt, null);
});

// ---------------------------------------------------------------- the open-time check

const client = ({ committed = { base: B }, lastAt = '2026-10-27T02:00:00Z', failRead = false, noStats = false } = {}) => ({
  calls: [],
  async getContentItem({ path }) { this.calls.push(['item', path]); if (failRead) throw new Error('offline'); return committed; },
  ...(noStats ? {} : { async itemStats({ path }) { this.calls.push(['stats', path]); return { revisions: 3, lastAt }; } }),
});
const PATH = 'members/a/posts/crystal-ball/index.md';

test('checkDraftBehind: a draft whose base is not the published one is behind, with both dates', async () => {
  const c = client();
  const r = await checkDraftBehind(c, { path: PATH, base: A, savedAt: '2026-10-26T21:42:00Z' }, { type: 'post', slug: 'crystal-ball' });
  assert.deepEqual(r, { behind: { publishedAt: '2026-10-27T02:00:00Z', savedAt: '2026-10-26T21:42:00Z' }, base: A });
  assert.deepEqual(c.calls.map((x) => x[0]).sort(), ['item', 'stats']);
});

test('checkDraftBehind: an up-to-date draft is not behind and keeps its base', async () => {
  const r = await checkDraftBehind(client({ committed: { base: A } }), { path: PATH, base: A, savedAt: '2026-10-28T00:00:00Z' }, {});
  assert.deepEqual(r, { behind: null, base: A });
});

test('checkDraftBehind: a draft saved before markers keeps reading as behind after its next save', async () => {
  const r = await checkDraftBehind(client(), { path: PATH, savedAt: '2026-10-26T21:42:00Z' }, {});
  assert.equal(r.base, BEHIND_BASE, 'a marker that matches no file, so a later save (later savedAt) still compares unequal');
  assert.ok(r.behind);
  assert.equal(draftBehind({ base: r.base, committedBase: B, savedAt: '2026-10-29T00:00:00Z', lastAt: '2026-10-27T02:00:00Z' }), true);
});

test('checkDraftBehind: an old draft found current adopts the published base, but only when both dates were read', async () => {
  const fresh = await checkDraftBehind(client(), { path: PATH, savedAt: '2026-10-28T00:00:00Z' }, {});
  assert.deepEqual(fresh, { behind: null, base: B });
  const noStats = await checkDraftBehind(client({ noStats: true }), { path: PATH, savedAt: '2026-10-28T00:00:00Z' }, {});
  assert.deepEqual(noStats, { behind: null, base: null }, 'nothing was established, so it is checked again next open');
});

test('checkDraftBehind claims nothing it could not read', async () => {
  const c = client({ failRead: true });
  assert.deepEqual(await checkDraftBehind(c, { path: PATH, base: A, savedAt: '2026-10-26T21:42:00Z' }, {}), { behind: null, base: A },
    'a failed read of the published item never raises a warning');
  assert.deepEqual(await checkDraftBehind(client(), { base: A }, {}), { behind: null, base: A }, 'a draft of an item never published');
  const repo = client();
  assert.deepEqual(await checkDraftBehind(repo, { path: PATH, base: B }, { store: 'repo' }), { behind: null, base: B }, 'a repo draft IS the committed file');
  assert.equal(repo.calls.length, 0, 'and costs no reads');
  assert.deepEqual(await checkDraftBehind({}, { path: PATH, base: A }, {}), { behind: null, base: A }, 'a host without the read');
});

// ---------------------------------------------------------------- the words

test('behindMessage names the dates only when they are true as written', () => {
  const fmt = (v) => `<${v.slice(5, 16)}>`;
  assert.equal(behindMessage({ publishedAt: '2026-10-27T02:00:00Z', savedAt: '2026-10-26T21:42:00Z', type: 'post' }, fmt),
    'The published article changed on <10-27T02:00>, after this draft was saved on <10-26T21:42>. This draft does not have those changes.');
  assert.equal(behindMessage({ publishedAt: '2026-10-27T02:00:00Z', savedAt: '2026-10-28T09:00:00Z', type: 'post' }, fmt),
    'The published article changed on <10-27T02:00>, after this draft was started. This draft does not have those changes.',
    'after a re-save, "changed after this draft was saved" would be false');
  assert.equal(behindMessage({ type: 'project' }, fmt), 'The published project changed after this draft was started. This draft does not have those changes.');
});

test('the words name the content type and stay free of dashes and contractions', () => {
  assert.equal(itemNoun('post'), 'article');
  assert.equal(itemNoun('prompt'), 'prompt');
  assert.equal(itemNoun('mystery'), 'item');
  assert.equal(staleMessage('post'), 'The published article changed after you opened this. Publishing now would replace those changes.');
  assert.equal(forceConfirmMessage('post'), 'Publish anyway? The changes made to the published article since you opened this are replaced.');
  // The editor's own copy for this feature: the banner buttons and the two confirmations.
  const editorCopy = src('client-ui/src/elements/editor-actions.mjs').match(/'[^'\n]*(?:published version|Keep editing|Publish anyway)[^'\n]*'|>[^<>]*(?:published version|Keep editing|Publish anyway)[^<>]*</g) || [];
  assert.ok(editorCopy.length >= 5, `the editor copy moved; this measures nothing (${editorCopy.length})`);
  const all = [behindMessage({ publishedAt: '2026-10-27T02:00:00Z', savedAt: '2026-10-26T21:42:00Z', type: 'post' }), behindMessage({ type: 'post' }), staleMessage('post'), staleDraftRowMessage('post'), forceConfirmMessage('post'), ...editorCopy].join(' | ');
  assert.ok(!/[\u2013\u2014]/.test(all), 'no em or en dash');
  assert.ok(!/\b\w+(n't|'re|'ve|'ll|'d)\b|\b(it|that|there|what)'s\b/i.test(all), `no contractions: ${all}`);
});

test('changeLabel names the newer side when the published version moved past this one', () => {
  const removed = { kind: 'block', op: 'removed', type: 'code' };
  assert.equal(changeLabel(removed), 'Code block removed');
  assert.equal(changeLabel(removed, { newer: true }), 'Code block only in the published version', 'the podcast block the draft lacks');
  assert.equal(changeLabel({ kind: 'block', op: 'added', type: 'paragraph' }, { newer: true }), 'Paragraph only in this version');
  assert.equal(changeLabel({ kind: 'field', label: 'Layout' }, { newer: true }), 'Layout differs');
  assert.equal(changeLabel({ kind: 'block', op: 'edited', type: 'paragraph' }, { newer: true }), 'Paragraph differs');
});

// ---------------------------------------------------------------- after a publish

test('followPublishedItem: the committed version becomes the base, the replaced one stays accepted', () => {
  const editing = { type: 'post', path: PATH, staged: true, base: A, behind: { publishedAt: null }, draftKey: { type: 'post', slug: 's' } };
  const next = followPublishedItem(editing, { path: PATH, base: B });
  assert.equal(next.base, B);
  assert.equal(next.prevBase, A);
  assert.equal(next.behind, null, 'the draft it published is gone');
  assert.equal(next.draftKey, null);
  const none = followPublishedItem(editing, { path: PATH });
  assert.deepEqual([none.base, none.prevBase], [null, null], 'no base back: no check rather than a false refusal');
  // After "Publish anyway" main held C, not the A the editor opened, and main can go on showing C until the merge
  // lands. Found by driving the editor: keeping A refused the very next publish.
  const forced = followPublishedItem(editing, { path: PATH, base: B, replaced: C });
  assert.deepEqual([forced.base, forced.prevBase], [B, C]);
  assert.equal(publishBaseProblem({ bases: [forced.base, forced.prevBase], committedBase: C }), null, 'the next publish is accepted');
});

// ---------------------------------------------------------------- the wiring

test('the website client reads, saves and checks the marker', () => {
  const c = src('src/lib/workbench-client.ts');
  assert.match(c, /const base = await contentBase\(text\);/, 'every read of an item computes its marker');
  assert.equal((c.match(/return \{ path, frontmatter, body(: reassembleMemberBody\(frontmatter, body, memberText\))?, base, \.\.\.skill \}/g) || []).length, 2,
    'both the public and the members-only read return it');
  assert.match(c, /\.\.\.\(typeof base === 'string' \? \{ base \} : \{\}\)/, 'saveDraft sends it only when the editor has one');
  assert.match(c, /\.\.\.\(typeof rec\.base === 'string' \? \{ bases: \[rec\.base\] \} : \{\}\)/, 'publishing from the work list is checked too');
  const p = src('src/lib/workbench-client-publish.ts');
  const check = p.indexOf('publishBaseProblem({ bases, committedBase: replaced, force })');
  assert.ok(check > 0, 'the publish compares the committed file');
  assert.ok(check < p.indexOf("workerPost('/membership/author'"), 'BEFORE anything is written');
  assert.match(p, /throw err\('published-changed', problem\)/);
  assert.match(p, /const base = committedIndex \? await contentBase\(committedIndex\.content as string\) : null;/, 'and returns the version it wrote');
  assert.match(p, /replaced = await contentBase\(oldText\);\n\s+const problem = publishBaseProblem\(\{ bases, committedBase: replaced, force \}\);/);
  assert.match(p, /return \{\n\s+base,\n\s+replaced,/, 'and the version it replaced');
  assert.ok(!/base/.test(src('src/lib/preview-edit.ts').match(/client\.saveDraft\(\{[\s\S]*?\}\);/)?.[0] || 'base'), 'the preview save sends no base, so the store keeps the stored one');
});

test('the workspace checks a draft on open and carries the marker into the editor', () => {
  const w = src('client-ui/src/elements/gbti-workspace.mjs');
  assert.match(w, /const \{ behind, base \} = await checkDraftBehind\(this\.client, full, d\);/);
  assert.match(w, /base: e\.base \?\? null, prevBase: e\.prevBase \?\? null, behind: e\.behind \?\? null, prepared:/, 'every mount passes all three');
  assert.match(w, /base: typeof full\.base === 'string' \? full\.base : null \}; \/\/ sow-109/, 'opening a published item records its version');
  assert.match(w, /addEventListener\('gbti-open-published', \(ev\) => openPublishedInto\(this, ev\?\.detail\)\)/);
  assert.match(w, /err\?\.code === 'published-changed' \? staleDraftRowMessage\(d\.type\)/);
});

test('the editor saves the base it opened with, and publish sends it with the choice to override', () => {
  const e = contentEditorSource();
  const save = e.slice(e.indexOf('this.client.saveDraft({'), e.indexOf('this.client.saveDraft({') + 900);
  assert.match(save, /\.\.\.\(this\._base \? \{ base: this\._base \} : \{\}\)/);
  const pub = e.slice(e.indexOf('async doPublish('), e.indexOf('_wireBehindActions() {'));
  assert.match(pub, /const bases = \[this\._base, this\._prevBase\]\.filter/);
  assert.match(pub, /\.\.\.\(bases\.length \? \{ bases \} : \{\}\), \.\.\.\(force \? \{ force: true \} : \{\}\)/);
  const refusal = pub.indexOf("if (err?.code === 'published-changed') { this._staleRefusal(); return; }");
  assert.ok(refusal > 0 && refusal < pub.indexOf('const h = failHint(err);'), 'the refusal is handled before the generic failure copy');
  assert.match(pub, /if \(typeof res\?\.base === 'string'\) \{ this\._prevBase = typeof res\.replaced === 'string' \? res\.replaced : this\._base; this\._base = res\.base; \}/,
    'the version the publish replaced, which after "Publish anyway" is not the one the editor opened');
  const anyway = e.slice(e.indexOf("pb.querySelector('#pubanyway')"), e.indexOf("pb.querySelector('#openpub')"));
  assert.match(anyway, /if \(typeof confirm === 'function' && !confirm\(forceConfirmMessage\(this\.type\)\)\) return;[^\n]*\n\s+this\.doPublish\(\{ force: true \}\);/,
    'Publish anyway asks first: in the harness a second press of Publish landed on it once the refusal pushed the editor down');
});

test('the behind banner takes the staged banner slot, and "Keep editing" lasts this visit only', () => {
  const e = contentEditorSource();
  assert.match(e, /\$\{this\._behind && !this\._behindHidden\s+\? behindBannerHtml\(\{ \.\.\.this\._behind, type: this\.type \}\)\s+: this\.staged\s+\? stagedBannerHtml\(\)/);
  assert.match(e, /this\._behindHidden = false;\n/, 'load() resets it, so the warning returns on the next open');
  assert.ok(e.includes('id="behinddiscard">Discard this draft and open the published version</button>'));
  assert.ok(e.includes('id="behindkeep">Keep editing the draft</button>'));
});

// ---------------------------------------------------------------- the workspace's half, on a stand-in element

const fakeWorkspace = (client) => ({
  client, _tab: 'post', _drafts: [{}], _overview: {}, rendered: 0, hash: null, problem: null,
  _editing: { type: 'post', path: PATH, staged: true, base: BEHIND_BASE, behind: { publishedAt: null }, draftKey: { type: 'post', slug: 'crystal-ball' } },
  _writeHash(h) { this.hash = h; },
  render() { this.rendered += 1; },
  $() { const ws = this; return { showProblem: (m) => { ws.problem = m; } }; },
});

test('openPublishedInto discards a staged draft first, then opens the published version with no warning', async () => {
  const calls = [];
  const ws = fakeWorkspace({
    async discardDraft(k) { calls.push(['discard', k]); },
    async getContentItem({ path }) { calls.push(['read', path]); return { frontmatter: { title: 'T' }, body: 'published body', base: B }; },
  });
  await openPublishedInto(ws, { discard: true });
  assert.deepEqual(calls.map((c) => c[0]), ['discard', 'read'], 'the draft goes first, or the next open brings it back');
  assert.deepEqual(calls[0][1], { type: 'post', slug: 'crystal-ball' });
  assert.deepEqual(ws._editing, { type: 'post', frontmatter: { title: 'T' }, body: 'published body', path: PATH, skillFile: null, base: B });
  assert.equal(ws._drafts, null, 'the work list re-reads its drafts');
  assert.equal(ws.rendered, 1);
  assert.equal(ws.hash, '#tab=post&edit=members%2Fa%2Fposts%2Fcrystal-ball%2Findex.md');
});

test('openPublishedInto: a stale tab discards nothing, and a failure is shown in the editor', async () => {
  const calls = [];
  const ws = fakeWorkspace({
    async discardDraft() { calls.push('discard'); },
    async getContentItem() { throw new Error('offline'); },
  });
  await openPublishedInto(ws, { discard: false });
  assert.deepEqual(calls, []);
  assert.equal(ws.problem, 'offline');
  assert.equal(ws.rendered, 0, 'the editor stays as it was');
});
