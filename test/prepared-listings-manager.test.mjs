// sow-427 E5: the superadmin's PREPARED LISTINGS manager. The pure rules (client-ui/src/prepared-listings-core.mjs),
// the website adapter (src/lib/workbench-prepared.ts, transpiled with esbuild so the real methods are called), and
// the hook lines that mount <gbti-prepared-listings> inside the coupon manager. The element itself needs a DOM, so it
// is held by source pins here and by its load decision, which lives in the core so the retry guard is tested for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as esbuild from 'esbuild';

import {
  PREPARED_SITE_BASE, PREPARE_NEW_HREF, PREPARED_STATE_LABELS, PREPARED_ACTION, preparedEditHref, preparedRowState,
  preparedStateLabel, preparedActions, preparedLinkFor, preparedProjectHref, preparedRowMeta, preparedDeleteConfirm,
  preparedResendCampaigns, preparedApplyResult, preparedLoadPlan,
} from '../client-ui/src/prepared-listings-core.mjs';
import { LISTING_STATE, claimLink } from '../membership/prepared-listings.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = 'ABCDEFGHJKMNPQRS';
const ID2 = '23456789ABCDEFGH';

async function loadAdapter() {
  const { code } = await esbuild.transform(read('src/lib/workbench-prepared.ts'), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** A manager row exactly as the Worker's listingSummary builds it. */
function row(over = {}) {
  return {
    id: ID, type: 'project', slug: 'surfacedby', title: 'SurfacedBy', recipientName: 'Sam', bound: false, boundLogin: null,
    campaign: 'SPRING', code: 'SPRINGABCDEFGHJK', priorCodes: [], state: 'prepared', inviteState: 'issued', redeemedByLogin: null,
    preparedByLogin: 'atwellpub', createdAt: '2026-09-30T12:00:00.000Z', updatedAt: '2026-09-30T12:00:00.000Z', revokedAt: null,
    claimPendingAt: null, prNumber: null, claimedAt: null, claimedLogin: null, claimedPath: null, imageCount: 2,
    ...over,
  };
}

// ---- states and actions --------------------------------------------------------------------------------------

test('every listing state has a label, and anything unrecognised or corrupt reads as Unreadable', () => {
  for (const s of Object.values(LISTING_STATE)) assert.ok(PREPARED_STATE_LABELS[s], `a label for ${s}`);
  assert.equal(preparedStateLabel(row()), 'Prepared');
  assert.equal(preparedStateLabel(row({ state: 'claimed' })), 'Claimed');
  assert.equal(preparedRowState(row({ state: 'weird' })), 'unknown');
  assert.equal(preparedRowState(row({ corrupt: true })), 'unknown', 'a record the Worker flagged is never acted on');
  assert.equal(preparedRowState(null), 'unknown');
  assert.equal(preparedRowState('prepared'), 'unknown');
});

test('the actions each state offers are exactly the ones the Worker accepts', () => {
  const { copy, edit, revoke, resend, remove, view } = PREPARED_ACTION;
  assert.deepEqual(preparedActions(row()), [copy, edit, revoke, remove]);
  assert.deepEqual(preparedActions(row({ state: 'revoked' })), [edit, resend, remove], 'a revoked link is dead: nothing to copy, Send again instead');
  assert.deepEqual(preparedActions(row({ state: 'publishing', prNumber: 12 })), [copy], 'the Worker refuses edit, revoke and delete while a claim publishes');
  assert.deepEqual(preparedActions(row({ state: 'claimed', claimedAt: '2026-10-02T00:00:00.000Z' })), [view, remove]);
  assert.deepEqual(preparedActions(row({ state: 'claimed', slug: null })), [remove], 'no project page without a slug');
  assert.deepEqual(preparedActions(row({ state: 'unknown' })), []);
  assert.deepEqual(preparedActions(row({ corrupt: true, key: 'invite-listing:X' })), []);
  assert.deepEqual(preparedActions(row({ id: 'invite-listing:bad' })), [], 'every action addresses the listing by a real id');
  assert.deepEqual(preparedActions(row({ code: null })), [edit, revoke, remove], 'no code, no link to copy');
});

test('links: the claim page for a live invitation, the project page once claimed, the WorkBench for edits', () => {
  assert.equal(preparedLinkFor(row()), claimLink(PREPARED_SITE_BASE, 'SPRINGABCDEFGHJK'));
  assert.equal(preparedLinkFor(row()), 'https://gbti.network/claim/?code=SPRINGABCDEFGHJK');
  assert.equal(preparedLinkFor(row({ state: 'revoked' })), null);
  assert.equal(preparedLinkFor(row({ state: 'claimed' })), null);
  assert.equal(preparedProjectHref(row({ state: 'claimed' })), 'https://gbti.network/projects/surfacedby/');
  assert.equal(preparedProjectHref(row()), null);
  assert.equal(preparedEditHref(ID), `/workbench/#prepare=${ID}`);
  assert.equal(preparedEditHref('../x'), null);
  assert.equal(PREPARE_NEW_HREF, '/workbench/#new=project&prepare=1');
});

test('the manager links agree with the WorkBench parser, so Edit and Prepare a listing open what they say', async () => {
  const { parseWorkspacePrepare } = await import('../client-ui/src/workspace-core.mjs');
  assert.deepEqual(parseWorkspacePrepare(preparedEditHref(ID).split('#')[1]), { id: ID });
  assert.deepEqual(parseWorkspacePrepare(PREPARE_NEW_HREF.split('#')[1]), { id: null });
  const { editingFromHash, preparedRestore } = await import('../client-ui/src/workspace-core.mjs');
  assert.deepEqual(editingFromHash(PREPARE_NEW_HREF.split('/workbench/')[1]).prepared, {}, 'Prepare a listing opens prepared mode');
  assert.deepEqual(preparedRestore(preparedEditHref(ID).split('/workbench/')[1]), { prepare: ID }, 'Edit reopens that listing');
});

test('row facts: who it greets, the tie, the campaign, and what has happened, never the message', () => {
  assert.deepEqual(preparedRowMeta(row()), ['For Sam', 'Open to whoever claims it first', 'Campaign SPRING', 'Prepared 2026-09-30 by @atwellpub']);
  assert.ok(preparedRowMeta(row({ bound: true, boundLogin: 'Sam-Dev' })).includes('Tied to @Sam-Dev'));
  assert.ok(preparedRowMeta(row({ bound: true, boundLogin: null })).includes('Tied to one GitHub account'));
  assert.ok(preparedRowMeta(row({ state: 'publishing', prNumber: 812 })).includes('Pull request #812 is open'));
  assert.ok(preparedRowMeta(row({ state: 'claimed', claimedAt: '2026-10-02T09:00:00.000Z', claimedLogin: 'sam' })).includes('Claimed 2026-10-02 by @sam'));
  assert.ok(preparedRowMeta(row({ redeemedByLogin: 'sam' })).includes('Free year taken by @sam'));
  assert.ok(preparedRowMeta(row({ priorCodes: ['A1', 'B2'] })).some((m) => m.startsWith('Sent again 2 times')));
  const all = JSON.stringify(preparedRowMeta(row({ message: 'SECRET MESSAGE', body: 'SECRET BODY' })));
  assert.ok(!all.includes('SECRET'), 'a row fact never repeats the message or the body');
  assert.deepEqual(preparedRowMeta(null), []);
});

test('the delete confirmation says what goes, and a claimed record says the project stays', () => {
  assert.match(preparedDeleteConfirm(row()), /for Sam\?.*images are removed.*cannot be undone/);
  assert.match(preparedDeleteConfirm(row({ state: 'claimed' })), /published project stays/);
});

test('Send again offers the active campaigns, the listing own one first', () => {
  const coupons = [{ code: 'fall' }, { code: 'SPRING' }, { code: 'OLD', active: false }, { code: 'fall' }];
  assert.deepEqual(preparedResendCampaigns(coupons, row()), ['SPRING', 'FALL']);
  assert.deepEqual(preparedResendCampaigns(coupons, row({ campaign: 'OLD' })), ['FALL', 'SPRING'], 'a retired campaign is not offered');
  assert.deepEqual(preparedResendCampaigns(null, row()), []);
});

test('a Worker answer updates the list in place: a new summary replaces its row, a delete removes it', () => {
  const rows = [row(), row({ id: ID2, title: 'Other' })];
  const revoked = preparedApplyResult(rows, { ok: true, changed: true, listing: row({ state: 'revoked' }) });
  assert.equal(revoked[0].state, 'revoked');
  assert.equal(revoked[1].id, ID2);
  assert.deepEqual(preparedApplyResult(rows, { ok: true, deleted: true, id: ID }, { deletedId: ID }).map((r) => r.id), [ID2]);
  assert.equal(preparedApplyResult(rows, { ok: true, listing: { id: 'bad' } }), rows, 'a malformed answer changes nothing');
  assert.equal(preparedApplyResult(rows, null), rows);
});

// ---- the load decision (sow-334) -------------------------------------------------------------------------------

test('preparedLoadPlan: one load per client, none after a failure until Try again, none without the capability', () => {
  const client = { preparedList() {} };
  assert.deepEqual(preparedLoadPlan({ client: {} }), { available: false, reset: false, load: false }, 'an admin client: nothing at all');
  assert.deepEqual(preparedLoadPlan({ client: null }), { available: false, reset: false, load: false });
  assert.deepEqual(preparedLoadPlan({ client }), { available: true, reset: true, load: true }, 'first render');
  // The element records the client it asked, then walks the statuses. Simulate the element's own sequence.
  let st = { status: 'loading', loadedFor: client };
  assert.equal(preparedLoadPlan({ ...st, client }).load, false, 'a load in flight is not started twice');
  st = { status: 'failed', loadedFor: client };
  for (let i = 0; i < 50; i += 1) assert.equal(preparedLoadPlan({ ...st, client }).load, false, 'a failure never loads again from render()');
  assert.equal(preparedLoadPlan({ status: 'ready', loadedFor: client, client }).load, false);
  assert.equal(preparedLoadPlan({ status: 'idle', loadedFor: client, client }).load, true, 'Try again resets the status to idle');
  const next = { preparedList() {} };
  assert.deepEqual(preparedLoadPlan({ status: 'failed', loadedFor: client, client: next }), { available: true, reset: true, load: true }, 'a new client earns exactly one');
});

test('the element takes its load decision from preparedLoadPlan and waits to be asked after a failure', () => {
  const src = read('client-ui/src/elements/gbti-prepared-listings.mjs');
  assert.match(src, /const plan = preparedLoadPlan\(\{ status: this\._status, loadedFor: this\._loadedFor, client: this\.client \}\);/);
  assert.match(src, /if \(plan\.load\) this\.load\(\);/);
  assert.match(src, /this\._loadedFor = client;\s*this\._status = 'loading';/, 'the status leaves idle before the first await');
  assert.match(src, /this\._status = rows \? 'ready' : 'failed';/, 'an empty or failed answer is its own status');
  assert.match(src, /data-retry>Try again<\/button>/);
  assert.match(src, /if \(client !== this\.client\) return;/, 'a stale answer never overwrites a newer client');
  assert.equal((src.match(/this\.load\(\)/g) || []).length, 1, 'render is the only caller, through the plan');
});

// ---- the website adapter -------------------------------------------------------------------------------------

test('the adapter attaches get, image and save for everyone, and the manager methods for a superadmin only', async () => {
  const { preparedMethods } = await loadAdapter();
  const noop = async () => ({});
  assert.deepEqual(Object.keys(preparedMethods({ workerGet: noop, workerPost: noop })).sort(), ['preparedGet', 'preparedImage', 'preparedSave']);
  assert.deepEqual(Object.keys(preparedMethods({ workerGet: noop, workerPost: noop, isSuperadmin: true })).sort(),
    ['preparedDelete', 'preparedGet', 'preparedImage', 'preparedList', 'preparedResend', 'preparedRevoke', 'preparedSave']);
});

test('each adapter method calls the one prepared route with the op the Worker expects', async () => {
  const { preparedMethods, PREPARED_ROUTE } = await loadAdapter();
  const calls = [];
  const m = preparedMethods({
    workerGet: async (path) => { calls.push(['GET', path]); return {}; },
    workerPost: async (path, body) => { calls.push(['POST', path, body]); return {}; },
    isSuperadmin: true,
  });
  await m.preparedList();
  await m.preparedGet(ID);
  await m.preparedImage(ID, 'icon.png');
  await m.preparedRevoke(ID);
  await m.preparedResend(ID, 'FALL');
  await m.preparedResend(ID);
  await m.preparedDelete(ID);
  assert.equal(PREPARED_ROUTE, '/membership/admin/prepared');
  assert.deepEqual(calls, [
    ['GET', '/membership/admin/prepared'],
    ['GET', `/membership/admin/prepared?id=${ID}`],
    ['GET', `/membership/admin/prepared?id=${ID}&image=icon.png`],
    ['POST', '/membership/admin/prepared', { op: 'revoke', id: ID }],
    ['POST', '/membership/admin/prepared', { op: 'resend', id: ID, campaign: 'FALL' }],
    ['POST', '/membership/admin/prepared', { op: 'resend', id: ID }],
    ['POST', '/membership/admin/prepared', { op: 'delete', id: ID }],
  ]);
});

test('the save body is an allow-list: no author note, author target, path or op override ever leaves', async () => {
  const { preparedMethods, preparedSaveBody } = await loadAdapter();
  const posted = [];
  const m = preparedMethods({ workerGet: async () => ({}), workerPost: async (path, body) => { posted.push(body); return {}; } });
  await m.preparedSave({
    op: 'delete', id: ID, campaign: 'SPRING', recipientName: 'Sam', message: 'Hi', githubLogin: 'sam',
    draft: { type: 'project', slug: 'x', frontmatter: { title: 'X' }, body: '' }, stagedItem: 'project:x',
    authorNote: 'not theirs', authorTarget: { scope: 'house' }, path: 'members/x/projects/x/index.md', files: [{}],
  });
  assert.deepEqual(Object.keys(posted[0]).sort(), ['campaign', 'draft', 'githubLogin', 'id', 'message', 'op', 'recipientName', 'stagedItem']);
  assert.equal(posted[0].op, 'save', 'a caller cannot turn a save into another op');
  assert.deepEqual(preparedSaveBody(null), { op: 'save' });
  assert.deepEqual(preparedSaveBody({ message: undefined, recipientName: '' }), { op: 'save', recipientName: '' }, 'an empty string is sent so the Worker can refuse it');
});

test('workbench-client spreads the prepared methods with one line, beside the other role-scoped methods', () => {
  const src = read('src/lib/workbench-client.ts');
  assert.match(src, /import \{ preparedMethods \} from '\.\/workbench-prepared';/);
  assert.match(src, /\.\.\.preparedMethods\(\{ workerGet, workerPost, isSuperadmin \}\),/);
  assert.equal(src.split('\n').filter((l) => l.includes('sow-427')).length, 2, 'hook lines only in a file over the cap');
});

// ---- the coupon manager hook and the element -------------------------------------------------------------------

test('the coupon manager mounts the listings only for a client with preparedList, and keeps one instance', () => {
  const src = read('client-ui/src/elements/gbti-coupon-manager.mjs');
  assert.match(src, /import '\.\/gbti-prepared-listings\.mjs';/);
  assert.match(src, /\$\{typeof this\.client\.preparedList === 'function' \? '<div data-prepared-slot><\/div>' : ''\}/);
  assert.match(src, /this\._prepEl \|\|= document\.createElement\('gbti-prepared-listings'\)/, 'kept, so a coupon action never reloads the listings');
  assert.match(src, /\{ coupons: this\._coupons \}/, 'the registry it already read feeds Send again');
});

test('the plain invite list hides every prepared invitation', () => {
  const src = read('client-ui/src/elements/gbti-coupon-manager.mjs');
  assert.match(src, /const items = \(this\._invites \|\| \[\]\)\.filter\(\(v\) => !v\?\.listingId\)\.map\(/);
});

test('the element: every button class names its own hover background, anchors drop the underline, [hidden] wins', () => {
  const src = read('client-ui/src/elements/gbti-prepared-listings.mjs');
  const css = src.slice(src.indexOf('const CSS = `'), src.indexOf('`;', src.indexOf('const CSS = `')));
  const classes = new Set();
  for (const m of src.matchAll(/<(?:button|a)\b[^>]*?\bclass="([a-z][a-z-]*)/g)) classes.add(m[1]);
  assert.deepEqual([...classes].sort(), ['pl-btn', 'pl-new']);
  for (const c of classes) {
    assert.match(css, new RegExp(`\\.${c}:hover \\{[^}]*background:`), `.${c}:hover sets its own background`);
    assert.match(css, new RegExp(`\\.${c} \\{[^}]*text-decoration:none`), `.${c} is worn by an anchor, so it drops the underline`);
  }
  assert.match(css, /\[hidden\] \{ display:none !important; \}/);
  assert.match(css, /\.pl-acts select \{ width:auto;/, 'BASE_CSS stretches a select to 100%');
});

test('the element escapes every value it renders from a row', () => {
  const src = read('client-ui/src/elements/gbti-prepared-listings.mjs');
  const rowHtml = src.slice(src.indexOf('  _rowHtml(row) {'), src.indexOf('  _wire() {'));
  assert.ok(rowHtml.length > 500, 'the row renderer moved; this assertion measures nothing');
  for (const m of rowHtml.matchAll(/\$\{([^}]+)\}/g)) {
    const expr = m[1].trim();
    const safe = /^esc\(/.test(expr) || /^(meta|link \?|parts|confirm|opts|btn\(|this\._busyId|camps\.length|acts\.includes)/.test(expr) || /^(act|extra)$/.test(expr);
    assert.ok(safe, `unescaped interpolation in the row: \${${expr}}`);
  }
});

// ---- guards over every new sow-427 website file ------------------------------------------------------------------

const NEW_FILES = [
  'client-ui/src/prepared-listings-core.mjs',
  'client-ui/src/elements/gbti-prepared-listings.mjs',
  'client-ui/src/prepared-editor.mjs',
  'src/lib/workbench-prepared.ts',
  'test/prepared-listings-manager.test.mjs',
];

test('every new file stays at or under 900 lines', () => {
  for (const f of NEW_FILES) {
    const n = read(f).split('\n').length;
    assert.ok(n <= 900, `${f} is ${n} lines`);
  }
});

// The writing rules for anything a person reads: no em or en dash, no spaced hyphen standing in for one, no
// contraction, and "free year", never the retired word for it. The whole file is scanned, comments included.
const RULES = [
  ['an em dash', /—/],
  ['an en dash', /–/],
  // A hyphen that opens a bullet line in a comment is a list marker, not a dash, so those lines are skipped.
  ['a spaced hyphen used as a dash', { test: (src) => src.split('\n').some((l) => / - /.test(l) && !/^\s*(?:\/\/|\*)\s+- /.test(l)) }],
  ['the retired name for the free year', new RegExp(`\\b${'tri'}al\\b`, 'i')],
  ['a contraction', /\b(?:can|don|won|isn|aren|doesn|didn|wasn|weren|hasn|haven|hadn|couldn|shouldn|wouldn)'t\b|\b(?:it|that|there|here|what|who|you|we|they|let)'(?:s|re|ll|ve|d)\b|\bI'(?:m|ll|ve|d)\b/i],
];

test('the writing rules hold in every new file, and the scan fires on each rule it enforces', () => {
  const controls = ['a — b', 'a – b', 'the page - it', `a ${'tri'}al member`, 'it can\'t', 'you\'re', 'that\'s'];
  for (const c of controls) assert.ok(RULES.some(([, re]) => re.test(c)), `the scan misses ${JSON.stringify(c)}`);
  assert.ok(!RULES.some(([, re]) => re.test('the listing\'s link')), 'a possessive is not a contraction');
  assert.ok(!RULES.some(([, re]) => re.test('// the list:\n//   - a bullet item\n * - another')), 'a comment bullet is not a dash');
  assert.ok(RULES.some(([, re]) => re.test('// a bullet opens\n// the page - it closes')), 'a dash later in a comment still fails');
  for (const f of [...NEW_FILES.filter((x) => !x.startsWith('test/')), 'test/prepared-editor.test.mjs']) {
    const src = read(f);
    for (const [what, re] of RULES) assert.ok(!re.test(src), `${f} has ${what}`);
  }
});

test('no new module logs: the invitation code in a link is a bearer secret', () => {
  for (const f of NEW_FILES.filter((x) => !x.startsWith('test/'))) assert.doesNotMatch(read(f), /console\./, f);
});
