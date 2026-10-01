// sow-427 E6: the WorkBench project editor's PREPARED MODE (client-ui/src/prepared-editor.mjs) and its deep links
// (client-ui/src/workspace-core.mjs parseWorkspacePrepare + planHashRoute). A superadmin writes a project for someone
// who is not a member yet; Save listing stores it privately with an invitation, and the person claims it under their
// own name. No network, no DOM: the editor is a small fake, and the website adapter (src/lib/workbench-prepared.ts) is
// transpiled with esbuild so the save is checked through the REAL request body the Worker would receive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as esbuild from 'esbuild';

import { parseWorkspacePrepare, planHashRoute, editingFromHash, preparedRestore } from '../client-ui/src/workspace-core.mjs';
import { workspaceSource } from './lib/workspace-source.mjs'; // the element and the two modules it was split into
import {
  blankPrepared, preparedFromLoad, canOfferPrepare, preparedEditRefusal, preparedEditingFrom, openPreparedListing,
  openPreparedInto, preparedChanged, activeCampaigns, preparedCampaigns, preparedCardHtml, preparedToggleHtml,
  preparedToolbarHtml, preparedParts, preparedTextProblem, buildPreparedPayload, preparedAfterSave, savePrepared,
  setPreparedMode, preparedImageReader, preparedClient, imageClientFor, PREPARED_CSS,
} from '../client-ui/src/prepared-editor.mjs';
import { contentEditorSource } from './lib/content-editor-source.mjs'; // the element plus the modules it was split into

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = 'ABCDEFGHJKMNPQRS'; // 16 characters of the invite alphabet
const ID2 = '23456789ABCDEFGH';

async function loadAdapter() {
  const { code } = await esbuild.transform(read('src/lib/workbench-prepared.ts'), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** A stand-in for <gbti-content-editor>: the members savePrepared and setPreparedMode touch, recorded. */
function fakeEditor({ prepared = blankPrepared(), input = {}, body = 'The body.', controls = {}, gatherThrows = null } = {}) {
  const outs = [];
  const events = [];
  const inputs = Object.entries(controls).map(([k, v]) => ({ dataset: { prep: k }, value: v, disabled: false, readOnly: false, addEventListener() {} }));
  return {
    _prepared: prepared,
    client: null,
    classList: { on: false, toggle(_c, v) { this.on = v; } },
    gather() { if (gatherThrows) throw gatherThrows; return { type: 'project', input: { ...input }, body }; },
    out(h, cls = 'muted') { outs.push({ h, cls }); },
    _btnBusy() { return () => {}; },
    _setChip() {},
    _banner() {},
    $() { return null; },
    $$(sel) { return sel === '[data-prep]' ? inputs : []; },
    emit(name, detail) { events.push({ name, detail }); },
    outs, events,
  };
}

const PROJECT = { title: 'SurfacedBy', slug: 'surfacedby', shortDescription: 'Finds what surfaced.', icon: './images/icon.png' };
const NEW_FIELDS = { recipientName: 'Sam', message: 'We built this page for your project.\nHave a look.', campaign: 'SPRING', githubLogin: '' };

// ---- the deep links ------------------------------------------------------------------------------------------

test('parseWorkspacePrepare: a new prepared project, a listing to edit, and nothing else', () => {
  assert.deepEqual(parseWorkspacePrepare('#new=project&prepare=1'), { id: null });
  assert.deepEqual(parseWorkspacePrepare('#prepare=1&new=project'), { id: null }, 'order does not matter');
  assert.deepEqual(parseWorkspacePrepare(`#prepare=${ID}`), { id: ID });
  assert.deepEqual(parseWorkspacePrepare(`#tab=project&prepare=${ID}`), { id: ID });
  assert.equal(parseWorkspacePrepare('#new=post&prepare=1'), null, 'only a project can be prepared (owner decision 9)');
  assert.equal(parseWorkspacePrepare('#new=prompt&prepare=1'), null);
  assert.equal(parseWorkspacePrepare('#prepare=1'), null, 'prepare=1 alone opens nothing');
  assert.equal(parseWorkspacePrepare(`#prepare=${ID.toLowerCase()}`), null, 'a listing id is upper case');
  assert.equal(parseWorkspacePrepare('#prepare=ABCDEFGHJKMNPQR'), null, '15 characters');
  assert.equal(parseWorkspacePrepare('#prepare=ABCDEFGHJKMNPQRSI'), null, '17 characters');
  assert.equal(parseWorkspacePrepare('#prepare=ABCDEFGHJKMNPQRI'), null, 'I is not in the invite alphabet');
  assert.equal(parseWorkspacePrepare('#prepare=..%2F..%2Fx'), null);
  assert.equal(parseWorkspacePrepare('#new=project'), null);
  assert.equal(parseWorkspacePrepare(''), null);
  assert.equal(parseWorkspacePrepare(undefined), null);
});

test('editingFromHash: the blank editor a #new= link opens, in prepared mode for a project with prepare=1', () => {
  assert.deepEqual(editingFromHash('#new=project&prepare=1'), { type: 'project', frontmatter: {}, body: '', prepared: {} });
  assert.deepEqual(editingFromHash('#new=project'), { type: 'project', frontmatter: {}, body: '' }, 'unchanged for a plain new (SOW-064)');
  assert.deepEqual(editingFromHash('#new=post&prepare=1'), { type: 'post', frontmatter: {}, body: '' }, 'only a project can be prepared');
  assert.deepEqual(editingFromHash('#new=product'), { type: 'project', frontmatter: {}, body: '' }, 'the old product link still opens a project');
  assert.equal(editingFromHash(`#prepare=${ID}`), null, 'an edit link opens through the restore, once the client exists');
  assert.equal(editingFromHash('#tab=post'), null);
  assert.equal(editingFromHash(''), null);
});

test('preparedRestore: a #prepare=<id> link becomes the one-shot restore, nothing else does', () => {
  assert.deepEqual(preparedRestore(`#prepare=${ID}`), { prepare: ID });
  assert.deepEqual(preparedRestore(`#tab=project&prepare=${ID}`), { prepare: ID });
  assert.equal(preparedRestore('#new=project&prepare=1'), null);
  assert.equal(preparedRestore(`#prepare=${ID.toLowerCase()}`), null);
  assert.equal(preparedRestore('#edit=members/a/projects/x/index.md'), null);
});

test('planHashRoute: prepare links never read as an exit, and change no tab on their own', () => {
  assert.deepEqual(planHashRoute('#new=project&prepare=1', { editing: false }), { action: 'openNew', type: 'project' });
  assert.deepEqual(planHashRoute(`#prepare=${ID}`, { editing: true, tab: 'overview' }), { action: 'none' }, 'the saved listing hash keeps the editor open');
  assert.deepEqual(planHashRoute(`#prepare=${ID}`, { editing: false, tab: 'project' }), { action: 'none' }, 'it opens on load, like #edit=');
  // Unchanged behaviour for every link that is not a prepare link (the SOW-104 table in workspace-core.test.mjs).
  assert.deepEqual(planHashRoute('#new=project', { editing: false }), { action: 'openNew', type: 'project' });
  assert.deepEqual(planHashRoute('#tab=project', { editing: true, tab: 'project' }), { action: 'exit', tab: 'project' });
  assert.deepEqual(planHashRoute('#tab=subs', { editing: false, tab: 'overview' }), { action: 'switchTab', tab: 'subs' });
  assert.deepEqual(planHashRoute('#new=project', { editing: true, tab: 'post' }), { action: 'none' });
});

// ---- the prepared state ----------------------------------------------------------------------------------------

test('preparedFromLoad: absent is off, {} is a blank new listing, a malformed id is dropped', () => {
  assert.equal(preparedFromLoad(null), null);
  assert.equal(preparedFromLoad(undefined), null);
  assert.deepEqual(preparedFromLoad({}), blankPrepared());
  assert.equal(preparedFromLoad({ id: 'not-an-id' }).id, null);
  const p = preparedFromLoad({ id: ID, recipientName: 'Sam', message: 'Hi', githubLogin: 'sam', campaign: 'SPRING', link: 'https://gbti.network/claim/?code=X', extra: 'dropped' });
  assert.equal(p.id, ID);
  assert.equal(p.recipientName, 'Sam');
  assert.equal('extra' in p, false);
  const src = { recipientName: 'Sam' };
  preparedFromLoad(src).recipientName = 'changed';
  assert.equal(src.recipientName, 'Sam', 'a fresh object, so the editor never edits the workspace copy in place');
});

test('canOfferPrepare: a superadmin, a NEW project, and a client that can save one', () => {
  const client = { preparedSave() {} };
  const ok = { role: 'superadmin', type: 'project', itemPath: null, prepared: null, client };
  assert.equal(canOfferPrepare(ok), true);
  assert.equal(canOfferPrepare({ ...ok, prepared: blankPrepared() }), true, 'still offered while on, so it can be turned off');
  assert.equal(canOfferPrepare({ ...ok, role: 'admin' }), false);
  assert.equal(canOfferPrepare({ ...ok, role: 'member' }), false);
  assert.equal(canOfferPrepare({ ...ok, role: null }), false, 'an unknown role fails closed');
  assert.equal(canOfferPrepare({ ...ok, type: 'post' }), false);
  assert.equal(canOfferPrepare({ ...ok, itemPath: 'members/a/projects/x/index.md' }), false, 'an existing project is not prepared');
  assert.equal(canOfferPrepare({ ...ok, prepared: { id: ID } }), false, 'a saved listing stays a listing');
  assert.equal(canOfferPrepare({ ...ok, client: {} }), false, 'a host without the method (the extension)');
});

test('preparedParts: a deep link cannot put a non-superadmin in prepared mode', async () => {
  const ed = { _statusRole: 'member', type: 'project', itemPath: null, _prepared: blankPrepared(), client: { preparedSave() {}, couponPool: async () => ({ coupons: [] }) } };
  assert.deepEqual(await preparedParts(ed), { toolbar: '', rail: '' });
  assert.equal(ed._prepared, null, 'the blank state is dropped, so no Save listing the Worker would refuse');
  const sa = { ...ed, _statusRole: 'superadmin', _prepared: null };
  const parts = await preparedParts(sa);
  assert.match(parts.toolbar, /id="prepsave"/);
  assert.match(parts.rail, /id="preptoggle"/);
  assert.match(parts.rail, /id="prepcard"/);
  // A saved listing opened for editing keeps its mode (the Worker already let this caller read it) and has no toggle.
  const edit = { ...ed, _statusRole: null, _prepared: preparedFromLoad({ id: ID }) };
  const p2 = await preparedParts(edit);
  assert.match(p2.rail, /id="prepcard"/);
  assert.doesNotMatch(p2.rail, /id="preptoggle"/);
});

test('preparedCampaigns: read once per editor, and a failure is an empty list rather than a retry', async () => {
  let calls = 0;
  const ed = { client: { couponPool: async () => { calls += 1; throw new Error('503'); } } };
  assert.deepEqual(await preparedCampaigns(ed), []);
  assert.deepEqual(await preparedCampaigns(ed), []);
  assert.equal(calls, 1);
  assert.deepEqual(activeCampaigns([{ code: 'spring', freeDays: 365 }, { code: 'OLD', active: false }, { code: 'SPRING' }, null]), [{ code: 'SPRING', freeDays: 365 }]);
});

// ---- opening a listing -----------------------------------------------------------------------------------------

const ADMIN_VIEW = {
  id: ID, state: 'prepared', inviteState: 'issued', recipientName: 'Sam', message: 'Hello', bound: true, boundLogin: 'Sam-Dev',
  campaign: 'SPRING', code: 'SPRINGABCDEFGHJK', frontmatter: { ...PROJECT }, body: 'Body', images: ['icon.png'],
};

test('preparedEditingFrom: the editor state for a listing, and a plain refusal for claimed or publishing', () => {
  const e = preparedEditingFrom({ ok: true, listing: ADMIN_VIEW, link: 'https://gbti.network/claim/?code=SPRINGABCDEFGHJK' });
  assert.equal(e.type, 'project');
  assert.equal(e.path, '', 'a prepared project has no path until it is claimed');
  assert.deepEqual(e.frontmatter, PROJECT);
  assert.equal(e.prepared.id, ID);
  assert.equal(e.prepared.githubLogin, 'Sam-Dev');
  assert.equal(e.prepared.link, 'https://gbti.network/claim/?code=SPRINGABCDEFGHJK');
  assert.equal(preparedEditingFrom({ listing: { ...ADMIN_VIEW, bound: false, boundLogin: 'stale' } }).prepared.githubLogin, '', 'an untied invitation shows no account');
  assert.throws(() => preparedEditingFrom({ listing: { ...ADMIN_VIEW, state: 'claimed', frontmatter: null } }), /claimed/);
  assert.throws(() => preparedEditingFrom({ listing: { ...ADMIN_VIEW, state: 'publishing' } }), /being published/);
  assert.throws(() => preparedEditingFrom({ listing: { ...ADMIN_VIEW, id: 'bad' } }), /could not be read/);
  assert.throws(() => preparedEditingFrom({}), /could not be read/);
  assert.equal(preparedEditRefusal({ state: 'revoked' }), null, 'a revoked listing can still be edited, then sent again');
});

test('openPreparedListing refuses a malformed id without a request, and a host without the method', async () => {
  let calls = 0;
  const client = { preparedGet: async () => { calls += 1; return { listing: ADMIN_VIEW }; } };
  await assert.rejects(openPreparedListing(client, 'nope'), /not a prepared listing/);
  assert.equal(calls, 0);
  await assert.rejects(openPreparedListing({}, ID), /website WorkBench/);
  assert.equal((await openPreparedListing(client, ID)).prepared.id, ID);
});

test('openPreparedInto: opens the editor, or lands on Projects with the reason', async () => {
  const hashes = [];
  const ws = { client: { preparedGet: async () => ({ listing: ADMIN_VIEW, link: 'L' }) }, _writeHash: (h) => hashes.push(h), render() { this.rendered = (this.rendered || 0) + 1; }, _ensureTab() {} };
  await openPreparedInto(ws, ID);
  assert.equal(ws._editing.prepared.id, ID);
  assert.deepEqual(hashes, [`#prepare=${ID}`]);
  assert.equal(ws.rendered, 1);
  const bad = { ...ws, client: { preparedGet: async () => { throw new Error('No prepared listing has that id.'); } }, rendered: 0 };
  await openPreparedInto(bad, ID);
  assert.equal(bad._editing, null);
  assert.equal(bad._draftMsg, 'No prepared listing has that id.');
  assert.equal(bad._tab, 'project');
});

test('preparedChanged: the workspace keeps the mode and the saved project, and a saved listing gets its own hash', () => {
  const hashes = [];
  const ws = { _editing: { type: 'project', frontmatter: {}, body: '' }, _writeHash: (h) => hashes.push(h) };
  preparedChanged(ws, { prepared: blankPrepared() });
  assert.deepEqual(ws._editing.prepared, blankPrepared());
  assert.deepEqual(hashes, [], 'no hash for an unsaved listing');
  preparedChanged(ws, { prepared: { ...blankPrepared(), id: ID }, frontmatter: PROJECT, body: 'Saved body' });
  assert.equal(ws._editing.prepared.id, ID);
  assert.deepEqual(ws._editing.frontmatter, PROJECT);
  assert.equal(ws._editing.body, 'Saved body');
  assert.deepEqual(hashes, [`#prepare=${ID}`]);
  preparedChanged(ws, { prepared: null });
  assert.equal(ws._editing.prepared, null, 'toggled off');
  assert.doesNotThrow(() => preparedChanged({ _editing: null }, { prepared: null }));
});

// ---- the save payload ------------------------------------------------------------------------------------------

test('buildPreparedPayload never carries authorNote, authorTarget or path, at any depth', () => {
  const gathered = { input: { ...PROJECT, authorNote: 'mine', authorTarget: { scope: 'member', username: 'x' }, path: 'members/x/projects/y/index.md', status: 'draft', updatedAt: 'now', visibility: 'members' }, body: 'Body' };
  for (const prepared of [{ ...blankPrepared(), ...NEW_FIELDS }, { ...blankPrepared(), ...NEW_FIELDS, id: ID }]) {
    const payload = buildPreparedPayload({ prepared, gathered });
    const json = JSON.stringify(payload);
    for (const k of ['authorNote', 'authorTarget', 'path']) assert.ok(!json.includes(`"${k}"`), `${k} must never be sent`);
    assert.equal(payload.draft.frontmatter.status, undefined, 'server fields are the claim\'s to set');
    assert.equal(payload.draft.frontmatter.visibility, undefined);
  }
});

test('buildPreparedPayload: create sends the campaign and an account only when given; edit sends the id and always the account', () => {
  const gathered = { input: { ...PROJECT }, body: 'Body' };
  const create = buildPreparedPayload({ prepared: { ...blankPrepared(), ...NEW_FIELDS, campaign: 'spring' }, gathered });
  assert.deepEqual(create, {
    op: 'save', campaign: 'SPRING', recipientName: 'Sam', message: NEW_FIELDS.message,
    draft: { type: 'project', slug: 'surfacedby', frontmatter: PROJECT, body: 'Body' }, stagedItem: 'project:surfacedby',
  });
  assert.equal('githubLogin' in create, false, 'blank on a create means first come, so it is not sent');
  assert.equal(buildPreparedPayload({ prepared: { ...NEW_FIELDS, githubLogin: ' @Sam ' }, gathered }).githubLogin, '@Sam');
  const edit = buildPreparedPayload({ prepared: { ...NEW_FIELDS, id: ID, githubLogin: '' }, gathered });
  assert.equal(edit.id, ID);
  assert.equal('campaign' in edit, false, 'the campaign is fixed while the invitation is out');
  assert.equal(edit.githubLogin, '', 'blank on an edit unties, so it is sent');
});

test('preparedTextProblem: the greeting, the message and a campaign are required; a login must be one', () => {
  assert.equal(preparedTextProblem({ ...NEW_FIELDS }), null);
  assert.match(preparedTextProblem({ ...NEW_FIELDS, recipientName: '  ' }), /name/);
  assert.match(preparedTextProblem({ ...NEW_FIELDS, message: '\n\t' }), /message/);
  assert.match(preparedTextProblem({ ...NEW_FIELDS, campaign: '' }), /campaign/);
  assert.equal(preparedTextProblem({ ...NEW_FIELDS, campaign: '', id: ID }), null, 'an edit keeps its campaign');
  assert.match(preparedTextProblem({ ...NEW_FIELDS, githubLogin: 'not a login!' }), /GitHub account/);
  assert.equal(preparedTextProblem({ ...NEW_FIELDS, githubLogin: '@Sam-Dev' }), null);
});

test('savePrepared through the real adapter: one POST to the prepared route, and no author note, target or path in it', async () => {
  const { preparedMethods } = await loadAdapter();
  const posts = [];
  const client = preparedMethods({
    workerGet: async () => { throw new Error('no reads expected'); },
    workerPost: async (route, body) => {
      posts.push({ route, body });
      return { ok: true, created: true, changed: true, code: 'SPRINGABCDEFGHJK', link: 'https://gbti.network/claim/?code=SPRINGABCDEFGHJK', listing: { id: ID, state: 'prepared', inviteState: 'issued', bound: false, boundLogin: null, campaign: 'SPRING', recipientName: 'Sam' } };
    },
  });
  const ed = fakeEditor({ input: { ...PROJECT, authorNote: 'stray' }, controls: NEW_FIELDS });
  const res = await savePrepared(ed, client);
  assert.equal(res.created, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].route, '/membership/admin/prepared');
  assert.equal(posts[0].body.op, 'save');
  const json = JSON.stringify(posts[0].body);
  for (const k of ['authorNote', 'authorTarget', 'path']) assert.ok(!json.includes(`"${k}"`), `${k} reached the Worker`);
  assert.equal(posts[0].body.recipientName, 'Sam', 'the live field value, read at save time');
  assert.equal(posts[0].body.stagedItem, 'project:surfacedby', 'the images staged under the draft item are the ones copied');
  // The editor now holds a saved listing: its id, its link, and the change is announced for the workspace.
  assert.equal(ed._prepared.id, ID);
  assert.equal(ed._prepared.link, 'https://gbti.network/claim/?code=SPRINGABCDEFGHJK');
  const ev = ed.events.find((e) => e.name === 'gbti-prepared-change');
  assert.equal(ev.detail.prepared.id, ID);
  assert.deepEqual(ev.detail.frontmatter, PROJECT, 'the saved project, without the stray note');
  assert.match(ed.outs.at(-1).h, /send it yourself/);
});

test('savePrepared refuses locally, with no request, when the invitation fields are not ready', async () => {
  let calls = 0;
  const client = { preparedSave: async () => { calls += 1; return {}; } };
  for (const controls of [{ ...NEW_FIELDS, recipientName: '' }, { ...NEW_FIELDS, message: '' }, { ...NEW_FIELDS, campaign: '' }, { ...NEW_FIELDS, githubLogin: '-bad-' }]) {
    const ed = fakeEditor({ input: PROJECT, controls });
    assert.equal(await savePrepared(ed, client), null);
    assert.equal(ed.outs.at(-1).cls, 'danger');
  }
  const noSlug = fakeEditor({ input: { title: 'x' }, controls: NEW_FIELDS });
  assert.equal(await savePrepared(noSlug, client), null);
  assert.match(noSlug.outs.at(-1).h, /permalink/);
  const threw = fakeEditor({ input: PROJECT, controls: NEW_FIELDS, gatherThrows: new Error('gallery json is broken') });
  assert.equal(await savePrepared(threw, client), null);
  assert.match(threw.outs.at(-1).h, /gallery json is broken/);
  assert.equal(await savePrepared(fakeEditor({ prepared: null }), client), null, 'not in prepared mode: nothing to save');
  assert.equal(calls, 0);
});

test('savePrepared shows the Worker refusal and keeps the listing unsaved', async () => {
  const err = Object.assign(new Error('A project on the site already uses the permalink surfacedby. Choose another one.'), { code: 'slug_taken' });
  const ed = fakeEditor({ input: PROJECT, controls: NEW_FIELDS });
  assert.equal(await savePrepared(ed, { preparedSave: async () => { throw err; } }), null);
  assert.equal(ed._prepared.id, null);
  assert.match(ed.outs.at(-1).h, /already uses the permalink/);
  assert.equal(ed.events.length, 0, 'no change is announced');
});

test('preparedAfterSave: the saved id, code, link and the canonical GitHub login; an untie clears it', () => {
  const p = preparedAfterSave({ ...NEW_FIELDS, githubLogin: 'sam-dev' }, { code: 'C', link: 'L', listing: { id: ID, state: 'prepared', bound: true, boundLogin: 'Sam-Dev', campaign: 'SPRING' } });
  assert.deepEqual([p.id, p.code, p.link, p.githubLogin, p.state], [ID, 'C', 'L', 'Sam-Dev', 'prepared']);
  assert.equal(preparedAfterSave({ githubLogin: 'x' }, { listing: { id: ID, bound: false } }).githubLogin, '');
});

test('setPreparedMode: on and off for a new project keeps what was typed; a saved listing cannot be turned off', () => {
  const ed = fakeEditor({ prepared: null });
  setPreparedMode(ed, true);
  assert.deepEqual(ed._prepared, blankPrepared());
  assert.equal(ed.classList.on, true);
  ed._prepared.recipientName = 'Sam';
  setPreparedMode(ed, false);
  assert.equal(ed._prepared, null);
  assert.equal(ed.classList.on, false);
  setPreparedMode(ed, true);
  assert.equal(ed._prepared.recipientName, 'Sam', 'restored from the stash');
  assert.deepEqual(ed.events.map((e) => Boolean(e.detail.prepared)), [true, false, true]);
  const saved = fakeEditor({ prepared: { ...blankPrepared(), id: ID } });
  setPreparedMode(saved, false);
  assert.equal(saved._prepared.id, ID);
});

// ---- images ----------------------------------------------------------------------------------------------------

test('preparedImageReader: the staged copy first, then the listing store, never a throw', async () => {
  const seen = [];
  const client = {
    getStagedImage: async (name, item) => { seen.push(['staged', name, item]); return name === 'new.png' ? { dataBase64: 'U1RBR0VE', contentType: 'image/png' } : null; },
    preparedImage: async (id, name) => { seen.push(['listing', id, name]); if (name === 'gone.png') throw new Error('404'); return { ok: true, name, dataBase64: 'TElTVElORw==', contentType: 'image/webp' }; },
  };
  const read = preparedImageReader(client, ID, 'project:surfacedby');
  assert.deepEqual(await read('new.png'), { dataBase64: 'U1RBR0VE', contentType: 'image/png' });
  assert.deepEqual(await read('icon.png'), { dataBase64: 'TElTVElORw==', contentType: 'image/webp' });
  assert.equal(await read('gone.png'), null);
  assert.deepEqual(seen[0], ['staged', 'new.png', 'project:surfacedby']);
  assert.equal(seen.filter((s) => s[0] === 'listing' && s[2] === 'new.png').length, 0, 'a staged hit never reads the store');
  assert.equal(await preparedImageReader(client, 'bad-id', 'x')('icon.png'), null, 'no listing id, no store read');
  assert.equal(await preparedImageReader({ getStagedImage: async () => { throw new Error('x'); } }, ID, 'x')('a.png'), null);
});

test('preparedClient widens only the staged-image read; imageClientFor uses it for a saved listing alone', async () => {
  const client = { status: () => 'status', getStagedImage: async () => null, preparedImage: async () => ({ dataBase64: 'QQ==' }) };
  const wrapped = preparedClient(client, ID);
  assert.equal(wrapped.status(), 'status');
  assert.equal((await wrapped.getStagedImage('a.png', 'project:x')).dataBase64, 'QQ==');
  assert.equal(preparedClient(client, 'bad'), client);
  assert.equal(imageClientFor({ client, _prepared: null }), client);
  assert.equal(imageClientFor({ client, _prepared: blankPrepared() }), client, 'an unsaved listing has nothing stored yet');
  assert.notEqual(imageClientFor({ client, _prepared: { id: ID } }), client);
});

// ---- markup ------------------------------------------------------------------------------------------------------

test('preparedCardHtml escapes every value, and shows the link only for a saved, live invitation', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const html = preparedCardHtml({ ...blankPrepared(), recipientName: evil, message: `</textarea><script>alert(1)</script>`, githubLogin: evil }, [{ code: 'SPRING', freeDays: 365 }]);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /data-prep-copy/, 'no link before the first save');
  assert.match(html, /365 free days/);
  const saved = preparedCardHtml({ ...blankPrepared(), id: ID, link: 'https://gbti.network/claim/?code=C', state: 'prepared', inviteState: 'issued', campaign: 'SPRING' }, []);
  assert.match(saved, /data-prep-copy/);
  assert.match(saved, /data-prep-open/);
  assert.match(saved, /<select id="prep-camp" data-prep="campaign" disabled>/, 'the campaign is fixed once the invitation is out');
  const revoked = preparedCardHtml({ ...blankPrepared(), id: ID, link: 'L', state: 'revoked', inviteState: 'revoked' }, []);
  assert.doesNotMatch(revoked, /data-prep-copy/, 'a revoked link is dead, so it is not offered');
  assert.match(revoked, /revoked/);
  const redeemed = preparedCardHtml({ ...blankPrepared(), id: ID, link: 'L', state: 'prepared', inviteState: 'redeemed', githubLogin: 'sam' }, []);
  assert.match(redeemed, /id="prep-login"[^>]*readonly/, 'the Worker refuses a binding change once the year is taken');
  assert.match(preparedCardHtml(null, []), /No active campaign/);
  assert.match(preparedToggleHtml(true), /id="prepon" checked/);
  assert.doesNotMatch(preparedToggleHtml(false), /checked/);
  assert.match(preparedToolbarHtml(), /class="ebtn prepsave" id="prepsave"/);
});

test('PREPARED_CSS hides Publish, Save draft, Preview, the author note and the audience switch in prepared mode', () => {
  for (const sel of ['#publish', '#draft', '#preview', '#secAuthorNote', '.visfield']) {
    assert.ok(PREPARED_CSS.includes(`:host(.prep-on) ${sel}`), `${sel} is hidden in prepared mode`);
  }
  assert.match(PREPARED_CSS, /:host\(\.prep-on\) #publish[^{]*\{ display:none !important; \}/, '!important, because .ebtn is inline-flex');
  assert.match(PREPARED_CSS, /:host\(:not\(\.prep-on\)\) #prepsave, :host\(:not\(\.prep-on\)\) #prepcard \{ display:none !important; \}/);
  assert.match(PREPARED_CSS, /\.preptoggle input\[type="checkbox"\] \{ width:auto;/, 'BASE_CSS stretches every input to 100%');
});

test('every button class prepared mode renders names its own hover background (BASE_CSS paints a bare hover green)', () => {
  const markup = preparedCardHtml({ ...blankPrepared(), id: ID, link: 'L', state: 'prepared', inviteState: 'issued' }, []) + preparedToolbarHtml() + preparedToggleHtml(false);
  const classes = new Set();
  for (const m of markup.matchAll(/<button\b[^>]*?\bclass="([^"]+)"/g)) classes.add(m[1].split(/\s+/).at(-1));
  assert.deepEqual([...classes].sort(), ['prepbtn', 'prepsave']);
  for (const c of classes) assert.match(PREPARED_CSS, new RegExp(`\\.${c}:hover \\{[^}]*background:`), `.${c}:hover sets a background`);
});

// ---- the hook lines ----------------------------------------------------------------------------------------------

test('the content editor carries hook lines only: every prepared behaviour is in prepared-editor.mjs', () => {
  const ed = contentEditorSource();
  assert.match(ed, /import \{ PREPARED_CSS, preparedFromLoad, preparedParts, wirePrepared, imageClientFor \} from '\.\.\/prepared-editor\.mjs';/);
  assert.match(ed, /load\(type, input, body, path, \{[^}]*prepared = null \} = \{\}\)/);
  assert.match(ed, /this\._prepared = preparedFromLoad\(prepared\);/);
  assert.match(ed, /this\._statusRole = st\?\.role \?\? null;/);
  assert.match(ed, /const prep = await preparedParts\(this\);/);
  // The component's own rules follow PREPARED_CSS; they moved from an inline template to content-editor-css.mjs.
  assert.match(ed, /SKILL_EDITOR_CSS : ''\) \+ PREPARED_CSS \+ CONTENT_EDITOR_CSS\)/);
  assert.match(ed, /\$\{prep\.toolbar\}/);
  assert.match(ed, /<aside class="rail">\s*\$\{prep\.rail\}/);
  assert.match(ed, /wirePrepared\(this\);/);
  assert.match(ed, /imageClientFor\(this\)\?\.getStagedImage\?\.\(name, item\)/);
  assert.match(ed, /if \(be && this\._prepared\?\.id\) be\.client = imageClientFor\(this\);/);
  assert.ok(ed.split('\n').filter((l) => l.includes('sow-427')).length <= 10, 'hook lines only');
  for (const fn of ['savePrepared', 'buildPreparedPayload', 'preparedCardHtml', 'setPreparedMode']) {
    assert.ok(!ed.includes(`${fn}(`), `${fn} stays in prepared-editor.mjs`);
  }
});

test('the workspace routes both prepare links and keeps the prepared state across its repaints', () => {
  const ws = workspaceSource();
  assert.match(ws, /import \{ openPreparedInto, preparedChanged \} from '\.\.\/prepared-editor\.mjs';/);
  assert.match(ws, /this\._editing = editingFromHash\(typeof location !== 'undefined' \? location\.hash : ''\);/, 'the first paint');
  assert.match(ws, /this\._editing = editingFromHash\(h\); this\.render\(\);/, 'a same-document #new= link');
  assert.match(ws, /return d \? \{ draft: d \} : preparedRestore\(hash\);/);
  assert.match(ws, /else if \(r\.prepare\) openPreparedInto\(this, r\.prepare\);/);
  const load = ws.split('\n').find((l) => l.includes('ed.load(e.type, e.frontmatter'));
  assert.match(load, /prepared: e\.prepared \?\? null/);
  assert.match(load, /authorNote: e\.authorNote \?\? null, skillFile: e\.skillFile \?\? null \}\);/, 'the sow-109 pin on the tail of this call still holds');
  assert.match(ws, /addEventListener\('gbti-prepared-change', \(ev\) => preparedChanged\(this, ev\.detail\)\)/);
  assert.ok(ws.split('\n').filter((l) => l.includes('sow-427')).length <= 8, 'hook lines only');
  // The element is held to its size by a ratchet (test/profile-editing.test.mjs). These hooks are paid for by moving
  // the #new= boot into workspace-core (editingFromHash), so the element did not grow at all. Since the split at the
  // 900-line limit (2026-09-30) the ceiling is the element file alone, the figure that ratchet measures.
  const el = read('client-ui/src/elements/gbti-workspace.mjs');
  const newlines = (el.match(/\n/g) || []).length; // the figure wc -l reports, and the one the ratchet measures
  assert.ok(newlines <= 718, `the WorkBench element grew: ${newlines} lines`);
});

// ---- guards --------------------------------------------------------------------------------------------------

test('the new prepared-mode files stay at or under 900 lines', () => {
  for (const f of ['client-ui/src/prepared-editor.mjs', 'test/prepared-editor.test.mjs']) {
    const n = read(f).split('\n').length;
    assert.ok(n <= 900, `${f} is ${n} lines`);
  }
});

test('prepared-editor.mjs never logs, and never touches innerHTML with a value it did not escape', () => {
  const src = read('client-ui/src/prepared-editor.mjs');
  assert.doesNotMatch(src, /console\./);
  assert.doesNotMatch(src, /innerHTML/, 'the card is replaced through outerHTML of escaped markup only');
});
