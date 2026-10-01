// sow-434 (spec choices 8 and 9): the SUGGESTED NOTE on a prepared listing, and the tied account's LOGIN in the
// public view. The preparer (or their agent) may leave an optional, factual starting point for the claimant's author
// note; the invitation preview shows it in the pinned "From the author" card and the claim dialog pre-fills its note
// box with it. The claimant still writes, edits or keeps, and submits the note themselves, so nothing here publishes.
//
// What this pins, layer by layer:
// - the shared rule: plain text cleaned exactly like the message, capped at the claim note's own 2000, refused (not
//   cut) when longer, and the three copies of that cap held together;
// - the record: created with it, edited, cleared, left alone when absent, nulled by the claim's minimize and by
//   erasure; shown in the admin view and the public view, never in the manager row;
// - the public view's githubLogin: the bound login only, null when untied, and never the account number;
// - the Worker save (create and edit) and the public read, through the real routes over a fake KV;
// - the WorkBench prepare card (markup, state, payload) and the website adapter's allow-list;
// - the agent tool: the schema parameter and its rule, still no authorNote, refused before any network call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as esbuild from 'esbuild';

import {
  MAX_SUGGESTED_NOTE, sanitizeSuggestedNote, sanitizeMessage, validateSuggestedNote, validatePreparedDraft, newListing,
  applyListingEdit, listingSummary, listingAdminView, publicListingView, minimizeClaimedListing, markListingClaimed,
  takeListingClaimLock,
} from '../membership/prepared-listings.mjs';
import { MAX_CLAIM_NOTE } from '../membership/prepared-claim-files.mjs';
import { NOTE_MAX } from '../src/lib/claim-core.mjs';
import { newInvite, inviteKey } from '../membership/invites.mjs';
import { draftImageKey } from '../membership/draft-images.mjs';
import { membershipPreparedPost, membershipPreparedGet } from '../workers/signup/membership-prepared-admin.mjs';
import { inviteListingRead } from '../workers/signup/prepared-claim-read.mjs';
import { erasePreparedListings } from '../scripts/lib/erase-prepared-listings.mjs';
import {
  blankPrepared, preparedFromLoad, preparedEditingFrom, preparedCardHtml, preparedTextProblem, buildPreparedPayload,
  savePrepared, SUGGESTED_NOTE_HINT,
} from '../client-ui/src/prepared-editor.mjs';
import { dispatch, TOOLS } from '../client/src/mcp-tools.mjs';
import { prepareListingOp } from '../client/src/operations.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-01T12:00:00.000Z');
const LATER = new Date('2026-10-02T12:00:00.000Z');
const ID = 'ABCDEFGHJKMNPQRS';
const ME = '2002207';
const BOUND = '5551234';
const CODE = 'CDEABEYEAR23456789';
const NOTE = 'SurfacedBy finds where a page is cited.\n\nIt runs every night and emails a digest.';

const draftOf = () => {
  const r = validatePreparedDraft({
    type: 'project', slug: 'surfacedby', body: 'It watches the web.',
    frontmatter: { title: 'SurfacedBy', shortDescription: 'Finds mentions.', icon: './images/icon.png', featuredImage: './images/cover.webp' },
  });
  assert.ok(r.ok, JSON.stringify(r.issues));
  return r.draft;
};
const listing = (over = {}, { suggestedNote } = {}) => ({
  ...newListing({
    id: ID, draft: draftOf(), recipientName: 'Sam', message: 'We wrote this up for you.', campaign: 'CODEABLEYEAR', code: CODE,
    preparedBy: ME, preparedByLogin: 'atwellpub', now: NOW, ...(suggestedNote === undefined ? {} : { suggestedNote }),
  }),
  ...over,
});

// ---- the shared rule ---------------------------------------------------------------------------------------------

test('the suggested note cap is the claim note cap, in all three places that state it', () => {
  assert.equal(MAX_SUGGESTED_NOTE, 2000);
  assert.equal(MAX_SUGGESTED_NOTE, MAX_CLAIM_NOTE, 'the Worker claim cap (prepared-claim-files.mjs)');
  assert.equal(MAX_SUGGESTED_NOTE, NOTE_MAX, 'the claim dialog textarea cap (claim-core.mjs)');
});

test('sanitizeSuggestedNote cleans exactly like the message: line breaks kept, controls and bidi removed, markup verbatim', () => {
  const samples = [
    'Line one\r\nline two', 'a\x00b\x07c\x1bd\x7fe', 'tab\there', 'one\n\n\n\n\ntwo', '  <b>hi</b> & <script>x</script>  ',
    'abc\u202edcba\u2066x', 'trailing   \nspace', '', '   ',
  ];
  for (const s of samples) assert.equal(sanitizeSuggestedNote(s), sanitizeMessage(s), JSON.stringify(s));
  assert.equal(sanitizeSuggestedNote('Line one\r\nline two'), 'Line one\nline two');
  assert.equal(sanitizeSuggestedNote('<b>hi</b>'), '<b>hi</b>', 'stored verbatim, made safe where it is rendered');
  assert.equal(sanitizeSuggestedNote(null), '');
  assert.equal(sanitizeSuggestedNote(42), '');
  assert.equal(sanitizeSuggestedNote('x'.repeat(MAX_SUGGESTED_NOTE + 50)).length, MAX_SUGGESTED_NOTE, 'the sanitizer alone caps');
  assert.equal(sanitizeMessage('x'.repeat(1500)).length, 1000, 'the message keeps its own, smaller cap');
});

test('validateSuggestedNote: absent, null and blank are none; not text and over the cap are refused, never cut', () => {
  assert.deepEqual(validateSuggestedNote(undefined), { ok: true, suggestedNote: '' });
  assert.deepEqual(validateSuggestedNote(null), { ok: true, suggestedNote: '' });
  assert.deepEqual(validateSuggestedNote(' \n\t '), { ok: true, suggestedNote: '' });
  assert.deepEqual(validateSuggestedNote(` ${NOTE} `), { ok: true, suggestedNote: NOTE });
  assert.equal(validateSuggestedNote('x'.repeat(MAX_SUGGESTED_NOTE)).ok, true, 'exactly at the cap is accepted');
  assert.equal(validateSuggestedNote(`${'x'.repeat(MAX_SUGGESTED_NOTE)}\x00\x00`).ok, true, 'measured after cleaning');
  const long = validateSuggestedNote('x'.repeat(MAX_SUGGESTED_NOTE + 1));
  assert.equal(long.ok, false);
  assert.equal(long.error, 'suggested_note_too_long');
  assert.match(long.message, /2000/);
  for (const bad of [42, {}, ['a'], true]) assert.equal(validateSuggestedNote(bad).error, 'invalid', JSON.stringify(bad));
});

// ---- the record ----------------------------------------------------------------------------------------------------

test('newListing stores the suggested note cleaned, and an empty string when there is none', () => {
  assert.equal(listing({}, { suggestedNote: `${NOTE}\u202e` }).suggestedNote, NOTE);
  assert.equal(listing().suggestedNote, '', 'optional');
  assert.equal(listing({}, { suggestedNote: null }).suggestedNote, '');
});

test('applyListingEdit sets, keeps and clears the suggestion, and an untouched form is still no change', () => {
  const rec = listing({}, { suggestedNote: NOTE });
  const set = applyListingEdit(rec, { suggestedNote: 'A new start.' }, { now: LATER });
  assert.equal(set.ok, true);
  assert.equal(set.changed, true);
  assert.equal(set.next.suggestedNote, 'A new start.');
  assert.equal(set.next.updatedAt, LATER.toISOString());
  const keep = applyListingEdit(rec, { message: 'Another hello.' }, { now: LATER });
  assert.equal(keep.next.suggestedNote, NOTE, 'absent means unchanged');
  for (const clear of ['', null, '  \n ']) {
    const c = applyListingEdit(rec, { suggestedNote: clear }, { now: LATER });
    assert.equal(c.next.suggestedNote, '', JSON.stringify(clear));
  }
  const same = applyListingEdit(rec, { suggestedNote: ` ${NOTE}\n` }, { now: LATER });
  assert.equal(same.changed, false, 'the same note after cleaning');
  // A listing saved before sow-434 has no field at all: saving an empty note is not a change either.
  const old = { ...listing() };
  delete old.suggestedNote;
  const untouched = applyListingEdit(old, { suggestedNote: '' }, { now: LATER });
  assert.equal(untouched.changed, false);
  assert.equal('suggestedNote' in untouched.next, false);
  const tooLong = applyListingEdit(rec, { suggestedNote: 'x'.repeat(MAX_SUGGESTED_NOTE + 1) }, { now: LATER });
  assert.deepEqual([tooLong.ok, tooLong.error], [false, 'suggested_note_too_long']);
  const claimed = applyListingEdit({ ...rec, claimedAt: NOW.toISOString() }, { suggestedNote: 'x' });
  assert.equal(claimed.error, 'not_editable');
});

test('a claim minimizes the suggestion away with the message and the project copy', () => {
  const locked = takeListingClaimLock(listing({}, { suggestedNote: NOTE }), { githubId: BOUND, now: NOW }).next;
  const min = minimizeClaimedListing(markListingClaimed(locked, { githubId: BOUND, folder: 'sam', path: 'p', now: NOW }).next);
  assert.equal(min.suggestedNote, null);
  assert.equal(min.message, null);
  assert.ok(!JSON.stringify(min).includes('emails a digest'));
});

// ---- the views -----------------------------------------------------------------------------------------------------

test('the manager row never carries the suggestion; the admin view and the public view do', () => {
  const inv = newInvite({ campaign: 'CODEABLEYEAR', code: CODE, listingId: ID, now: NOW });
  const rec = listing({}, { suggestedNote: NOTE });
  const row = listingSummary(rec, inv, NOW);
  assert.equal('suggestedNote' in row, false);
  assert.ok(!JSON.stringify(row).includes('emails a digest'), 'not under any other key either');
  assert.equal(listingAdminView(rec, inv, NOW).suggestedNote, NOTE);
  assert.equal(publicListingView(rec, null).suggestedNote, NOTE);
  const old = { ...listing() };
  delete old.suggestedNote;
  assert.equal(listingAdminView(old, inv, NOW).suggestedNote, '', 'a listing saved before sow-434 reads as none');
  assert.equal(publicListingView(old, null).suggestedNote, '');
  assert.equal(publicListingView(minimizeClaimedListing(rec), null).suggestedNote, '', 'a minimized null is never shown as text');
});

test('the public githubLogin is the bound login only: null when untied, and never the account number', () => {
  const tied = publicListingView(listing({ boundGithubId: BOUND, boundLogin: 'Sam-Dev' }), null);
  assert.equal(tied.githubLogin, 'Sam-Dev');
  assert.ok(!JSON.stringify(tied).includes(BOUND), 'the account number never leaves');
  assert.equal(publicListingView(listing(), null).githubLogin, null, 'untied');
  assert.equal(publicListingView(listing({ boundGithubId: null, boundLogin: 'Sam-Dev' }), null).githubLogin, null,
    'a stray login with no tie is not a tie');
  assert.equal(publicListingView(listing({ boundGithubId: BOUND, boundLogin: null }), null).githubLogin, null);
  assert.equal(publicListingView(listing({ boundGithubId: BOUND, boundLogin: '-not a login/' }), null).githubLogin, null,
    'fail closed: only a well-formed login is ever used to build a GitHub link');
  assert.equal(publicListingView(null, null).githubLogin, null);
});

// ---- erasure -----------------------------------------------------------------------------------------------------

test('erasure of a claimant nulls a suggestion that somehow outlived the claim', async () => {
  const store = new Map([[`invite-listing:${ID}`, JSON.stringify(listing({ claimedAt: NOW.toISOString(), claimedBy: BOUND, frontmatter: null }, { suggestedNote: NOTE }))]]);
  const kvOps = {
    listKvByPrefix: async ({ prefix }) => {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { available: true, keys, entries: keys.map((key) => ({ key, value: JSON.parse(store.get(key)) })) };
    },
    putKvValue: async ({ key, value }) => { store.set(key, value); return { ok: true }; },
    deleteKvKey: async ({ key }) => { store.delete(key); return { deleted: true }; },
  };
  const r = await erasePreparedListings({ githubId: BOUND, env: {}, kvOps, now: NOW });
  assert.equal(r.minimized, 1);
  assert.equal(JSON.parse(store.get(`invite-listing:${ID}`)).suggestedNote, null);
});

// ---- the Worker save and the public read ------------------------------------------------------------------------------

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix || '')).map((name) => ({ name })), list_complete: true }; },
  };
}
const COUPONS = JSON.stringify({ generatedAt: NOW.toISOString(), coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'member' }] });
const okAuth = async () => ({ ok: true, githubId: ME, role: 'superadmin', mirror: { roles: { superadmins: [{ github_id: ME, login: 'atwellpub' }] } } });
function seqBytes() {
  let call = 0;
  return (n) => { call += 1; return Uint8Array.from({ length: n }, (_, i) => (call * 17 + i * 3) % 240); };
}
const lookupUser = async (_env, login) => (String(login).toLowerCase() === 'sam-dev'
  ? { ok: true, githubId: BOUND, login: 'Sam-Dev', name: 'Sam' }
  : { ok: false, status: 404, message: 'No personal GitHub account has that name.' });
const baseDeps = {
  authorize: okAuth, now: NOW, lookupUser, getToken: async () => 'tok', siteBase: 'https://gbti.network',
  readTree: async () => ({ content: [], shares: [] }), loadHouse: async () => ({ ok: true, parsed: {} }),
};
const DRAFT = {
  type: 'project', slug: 'surfacedby', body: 'It watches the web.',
  frontmatter: { title: 'SurfacedBy', shortDescription: 'x', icon: './images/icon.png', featuredImage: './images/cover.webp' },
};
const stagedImage = (name, fill) => [draftImageKey(ME, 'project:surfacedby', name), JSON.stringify({ dataBase64: Buffer.alloc(40, fill).toString('base64'), contentType: 'image/png', bytes: 40 })];
const postReq = (body) => new Request('https://x/membership/admin/prepared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const getReq = (qs = '') => new Request(`https://x/membership/admin/prepared${qs}`, { method: 'GET' });

function world() {
  const kv = fakeKv({ 'coupons:config': COUPONS, ...Object.fromEntries([stagedImage('icon.png', 1), stagedImage('cover.webp', 2)]) });
  const rand = seqBytes();
  const post = (body, over = {}) => membershipPreparedPost(postReq(body), { SIGNUP_KV: kv }, { ...baseDeps, randomBytes: rand, ...over });
  const create = (over = {}) => post({
    op: 'save', campaign: 'CODEABLEYEAR', recipientName: 'Sam', message: 'Hello Sam.', draft: DRAFT, stagedItem: 'project:surfacedby', ...over,
  });
  const stored = (id) => JSON.parse(kv.store.get(`invite-listing:${id}`));
  return { kv, post, create, stored };
}

test('Worker create: the suggestion is stored cleaned, shown to Edit, and kept out of the manager row', async () => {
  const w = world();
  const r = await w.create({ suggestedNote: `${NOTE}\r\n`, githubLogin: 'sam-dev' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.listing.id;
  assert.equal(w.stored(id).suggestedNote, NOTE);
  assert.equal('suggestedNote' in r.body.listing, false, 'the save answers with the manager row, which has none');
  const edit = await membershipPreparedGet(getReq(`?id=${id}`), { SIGNUP_KV: w.kv }, { authorize: okAuth, now: NOW });
  assert.equal(edit.body.listing.suggestedNote, NOTE);
  const rows = await membershipPreparedGet(getReq(), { SIGNUP_KV: w.kv }, { authorize: okAuth, now: NOW });
  assert.ok(!JSON.stringify(rows.body).includes('emails a digest'), 'never in the manager list');
  // The public read through the real route: the suggestion and the tied login, never the number.
  const pub = await inviteListingRead(new Request(`https://x/invite/listing?code=${r.body.code}`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), {}, { kv: w.kv, now: NOW });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.listing.suggestedNote, NOTE);
  assert.equal(pub.body.listing.githubLogin, 'Sam-Dev');
  assert.ok(!JSON.stringify(pub.body).includes(BOUND));
});

test('Worker create without a suggestion stores none; a long or non-text one is refused and writes nothing', async () => {
  const w = world();
  const r = await w.create();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(w.stored(r.body.listing.id).suggestedNote, '');
  const pub = await inviteListingRead(new Request(`https://x/invite/listing?code=${r.body.code}`, { headers: { 'CF-Connecting-IP': '203.0.113.10' } }), {}, { kv: w.kv, now: NOW });
  assert.equal(pub.body.listing.githubLogin, null, 'untied');
  for (const [bad, error] of [['x'.repeat(MAX_SUGGESTED_NOTE + 1), 'suggested_note_too_long'], [42, 'invalid'], [{ text: 'x' }, 'invalid']]) {
    const fresh = world();
    const refused = await fresh.create({ suggestedNote: bad });
    assert.equal(refused.status, 400, JSON.stringify(bad));
    assert.equal(refused.body.error, error);
    assert.deepEqual([...fresh.kv.store.keys()].filter((k) => k.startsWith('invite')), [], 'no invite, no listing, no image');
    assert.ok(fresh.kv.store.has(draftImageKey(ME, 'project:surfacedby', 'icon.png')), 'the staged image waits for the retry');
  }
});

test('Worker edit: the suggestion alone changes it, absent leaves it, empty clears it', async () => {
  const w = world();
  const id = (await w.create({ suggestedNote: NOTE })).body.listing.id;
  const set = await w.post({ op: 'save', id, suggestedNote: 'A shorter start.' }, { now: LATER });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.changed, true);
  assert.equal(w.stored(id).suggestedNote, 'A shorter start.');
  assert.equal(w.stored(id).message, 'Hello Sam.', 'nothing else moved');
  assert.equal(w.stored(id).updatedAt, LATER.toISOString());
  const msg = await w.post({ op: 'save', id, message: 'Hello again.' }, { now: new Date('2026-10-03T12:00:00.000Z') });
  assert.equal(msg.status, 200, JSON.stringify(msg.body));
  assert.equal(w.stored(id).suggestedNote, 'A shorter start.', 'absent means unchanged');
  const cleared = await w.post({ op: 'save', id, suggestedNote: '' }, { now: new Date('2026-10-04T12:00:00.000Z') });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(w.stored(id).suggestedNote, '');
  const same = await w.post({ op: 'save', id, suggestedNote: null }, { now: new Date('2026-10-05T12:00:00.000Z') });
  assert.equal(same.body.changed, false, 'clearing what is already clear is no change');
  const tooLong = await w.post({ op: 'save', id, suggestedNote: 'x'.repeat(MAX_SUGGESTED_NOTE + 1) });
  assert.equal(tooLong.status, 400);
  assert.equal(w.stored(id).suggestedNote, '', 'a refused edit writes nothing');
});

// ---- the WorkBench prepare card --------------------------------------------------------------------------------------

test('the prepare card: a Suggested note textarea with the rule as its hint, capped, and its value escaped', () => {
  assert.equal(SUGGESTED_NOTE_HINT, 'A starting point they can edit or keep. State facts about the work; never invent their reasons.');
  const html = preparedCardHtml({ ...blankPrepared(), suggestedNote: '</textarea><script>alert(1)</script>' }, [{ code: 'SPRING', freeDays: 365 }]);
  assert.match(html, /<label for="prep-note">Suggested note \(optional\)<\/label>/);
  assert.match(html, new RegExp(`<textarea id="prep-note" data-prep="suggestedNote" maxlength="${MAX_SUGGESTED_NOTE}"`));
  assert.ok(html.includes(SUGGESTED_NOTE_HINT), 'the hint is shown');
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.indexOf('id="prep-msg"') < html.indexOf('id="prep-note"') && html.indexOf('id="prep-note"') < html.indexOf('id="prep-camp"'),
    'after the personal message, before the campaign');
});

test('the prepared state carries the suggestion: blank, loaded from Edit, and through preparedFromLoad', () => {
  assert.equal(blankPrepared().suggestedNote, '');
  assert.equal(preparedFromLoad({ suggestedNote: NOTE }).suggestedNote, NOTE);
  assert.equal(preparedFromLoad({ suggestedNote: 42 }).suggestedNote, '', 'only text is taken');
  const view = { id: ID, state: 'prepared', inviteState: 'issued', recipientName: 'Sam', message: 'Hi', suggestedNote: NOTE, bound: false, campaign: 'SPRING', frontmatter: { title: 'X', slug: 'x' }, body: '' };
  assert.equal(preparedEditingFrom({ listing: view }).prepared.suggestedNote, NOTE);
  assert.equal(preparedEditingFrom({ listing: { ...view, suggestedNote: undefined } }).prepared.suggestedNote, '');
});

test('buildPreparedPayload: a create sends the suggestion only when given; an edit always sends it, so blank clears', () => {
  const gathered = { input: { title: 'SurfacedBy', slug: 'surfacedby' }, body: 'Body' };
  const fields = { recipientName: 'Sam', message: 'Hi', campaign: 'SPRING', githubLogin: '' };
  assert.equal(buildPreparedPayload({ prepared: { ...blankPrepared(), ...fields, suggestedNote: NOTE }, gathered }).suggestedNote, NOTE);
  assert.equal('suggestedNote' in buildPreparedPayload({ prepared: { ...blankPrepared(), ...fields, suggestedNote: '  ' }, gathered }), false);
  const edit = buildPreparedPayload({ prepared: { ...fields, id: ID, suggestedNote: '' }, gathered });
  assert.equal(edit.suggestedNote, '');
  assert.equal(buildPreparedPayload({ prepared: { ...fields, id: ID }, gathered }).suggestedNote, '', 'an old state with no key clears nothing it did not have');
  assert.equal(buildPreparedPayload({ prepared: { ...fields, id: ID, suggestedNote: NOTE }, gathered }).suggestedNote, NOTE);
  assert.equal(buildPreparedPayload({ prepared: { ...fields, suggestedNote: NOTE }, gathered }).draft.frontmatter.suggestedNote, undefined,
    'it travels beside the project, never inside it');
  assert.match(preparedTextProblem({ ...fields, suggestedNote: 'x'.repeat(MAX_SUGGESTED_NOTE + 1) }), /suggested note/);
  assert.equal(preparedTextProblem({ ...fields, suggestedNote: NOTE }), null);
});

test('savePrepared through the real website adapter: the typed suggestion reaches the Worker, the author note does not', async () => {
  const { code } = await esbuild.transform(read('src/lib/workbench-prepared.ts'), { loader: 'ts', format: 'esm' });
  const { preparedMethods, preparedSaveBody } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.deepEqual(preparedSaveBody({ suggestedNote: NOTE, authorNote: 'not theirs' }), { op: 'save', suggestedNote: NOTE }, 'allow-listed');
  const posts = [];
  const client = preparedMethods({
    workerGet: async () => ({}),
    workerPost: async (_route, body) => { posts.push(body); return { ok: true, created: true, code: 'C', link: 'L', listing: { id: ID, state: 'prepared', bound: false } }; },
  });
  const controls = { recipientName: 'Sam', message: 'Hi', campaign: 'SPRING', githubLogin: '', suggestedNote: NOTE };
  const inputs = Object.entries(controls).map(([k, v]) => ({ dataset: { prep: k }, value: v, disabled: false, readOnly: false, addEventListener() {} }));
  const editor = {
    _prepared: blankPrepared(), classList: { toggle() {} }, outs: [],
    gather() { return { type: 'project', input: { title: 'SurfacedBy', slug: 'surfacedby', authorNote: 'stray' }, body: 'B' }; },
    out(h) { this.outs.push(h); }, _btnBusy() { return () => {}; }, _setChip() {}, _banner() {}, emit() {},
    $() { return null; }, $$(sel) { return sel === '[data-prep]' ? inputs : []; },
  };
  const res = await savePrepared(editor, client);
  assert.equal(res?.created, true, JSON.stringify(editor.outs));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].suggestedNote, NOTE, 'read from the live field at save time');
  assert.ok(!JSON.stringify(posts[0]).includes('"authorNote"'));
  assert.equal(editor._prepared.suggestedNote, NOTE, 'the saved state keeps it, so the card repaints with it');
});

// ---- the agent tool ------------------------------------------------------------------------------------------------

const ROLES = "superadmins:\n  - github_id: '1'\n";
function agentCtx() {
  const calls = [];
  const ctx = {
    identity: () => ({ login: 'owner', githubId: '1', username: 'owner' }),
    reader: { readFile: async (p) => (p === 'house/roles.yml' ? ROLES : null) },
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ path: new URL(String(url)).pathname, body });
      return { ok: true, status: 200, json: async () => ({ ok: true, created: !body?.id, code: 'SPRING26X7K2M9Q4TR', listing: { id: '23456789ABCDEFGH', state: 'prepared', bound: false } }) };
    },
  };
  return { ctx, calls };
}
const agentArgs = (over = {}) => ({
  input: { title: 'SurfacedBy', slug: 'surfacedby', shortDescription: 'x' }, body: 'Facts.', recipientName: 'Sam', message: 'Hello.', campaign: 'SPRING26', ...over,
});
const callTool = (args, ctx) => dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'prepare_listing', arguments: args } }, ctx);

test('prepare_listing lists suggestedNote with the rule, and still takes no authorNote', () => {
  const tool = TOOLS.find((t) => t.name === 'prepare_listing');
  const p = tool.inputSchema.properties.suggestedNote;
  assert.equal(p?.type, 'string');
  assert.match(p.description, /^Optional\./);
  assert.match(p.description, new RegExp(`at most ${MAX_SUGGESTED_NOTE} characters`), 'the stated cap is the real one');
  assert.match(p.description, /State facts about the work; never invent their reasons/);
  assert.match(p.description, /edit or keep/);
  assert.equal(tool.inputSchema.required.includes('suggestedNote'), false);
  assert.equal('authorNote' in tool.inputSchema.properties, false);
  assert.match(tool.description, /author note belongs to the recipient/);
  assert.match(tool.description, /`suggestedNote`/);
  assert.match(tool.description, /never invent their reasons/);
});

test('prepare_listing forwards the suggestion on a create, and on an edit only when passed (null clears)', async () => {
  const a = agentCtx();
  await prepareListingOp(a.ctx, agentArgs({ suggestedNote: NOTE }));
  assert.equal(a.calls.at(-1).body.suggestedNote, NOTE);
  const b = agentCtx();
  await prepareListingOp(b.ctx, agentArgs());
  assert.equal('suggestedNote' in b.calls.at(-1).body, false, 'absent is left out');
  const c = agentCtx();
  await prepareListingOp(c.ctx, { id: '23456789ABCDEFGH', input: agentArgs().input, suggestedNote: null });
  assert.equal(c.calls.at(-1).body.suggestedNote, '', 'null clears it');
});

test('prepare_listing refuses an author note, a non-text or an over-long suggestion with zero fetches', async () => {
  const cases = {
    'an author note': { authorNote: 'I built this because' },
    'a number': { suggestedNote: 42 },
    'an object': { suggestedNote: { text: 'x' } },
    'over the cap': { suggestedNote: 'x'.repeat(MAX_SUGGESTED_NOTE + 1) },
  };
  for (const [label, over] of Object.entries(cases)) {
    const { ctx, calls } = agentCtx();
    const res = await callTool(agentArgs({ ...over, images: [{ name: 'icon.png', dataBase64: 'iVBORw0KGgo=' }] }), ctx);
    assert.equal(res.result.isError, true, label);
    assert.equal(JSON.parse(res.result.content[0].text).error, 'bad-request', label);
    assert.equal(calls.length, 0, `${label}: nothing staged, nothing saved`);
  }
  const { ctx } = agentCtx();
  const res = await callTool(agentArgs({ authorNote: 'x' }), ctx);
  assert.match(JSON.parse(res.result.content[0].text).message, /suggestedNote/, 'the refusal points at the field that is allowed');
});

// ---- writing rules and guards ----------------------------------------------------------------------------------------

test('every new string follows the writing rules', () => {
  const tool = TOOLS.find((t) => t.name === 'prepare_listing');
  const html = preparedCardHtml(blankPrepared(), []);
  const card = html.slice(html.indexOf('for="prep-note"'), html.indexOf('for="prep-camp"'));
  const strings = [
    tool.description, tool.inputSchema.properties.suggestedNote.description, SUGGESTED_NOTE_HINT, card,
    validateSuggestedNote('x'.repeat(MAX_SUGGESTED_NOTE + 1)).message, validateSuggestedNote(1).message,
  ];
  const contraction = /\b(?:can't|won't|don't|doesn't|isn't|aren't|wasn't|didn't|hasn't|haven't|couldn't|wouldn't|shouldn't|it's|that's|there's|you're|we're|they're|you've|let's)\b/i;
  for (const t of strings) {
    assert.ok(t.length > 10, 'a string was found');
    assert.doesNotMatch(t, /[\u2014\u2013]/, 'no em or en dash');
    assert.doesNotMatch(t, /[A-Za-z0-9,.)] - [A-Za-z0-9(]/, 'no spaced hyphen standing in for a dash');
    assert.doesNotMatch(t, /\btrial\b/i, '"free year", never "trial"');
    assert.doesNotMatch(t, contraction);
  }
  assert.match('a \u2014 b', /[\u2014\u2013]/, 'control');
  assert.match('you don\'t', contraction, 'control');
});

test('no module this touched logs, and the files stay at or under 900 lines', () => {
  const files = [
    'membership/prepared-listings-shared.mjs', 'membership/prepared-listings.mjs', 'workers/signup/membership-prepared-admin.mjs',
    'workers/signup/prepared-claim-read.mjs', 'scripts/lib/erase-prepared-listings.mjs', 'client-ui/src/prepared-editor.mjs',
    'src/lib/workbench-prepared.ts', 'client/src/operations-admin.mjs', 'client/src/mcp-tools.mjs', 'test/prepared-suggested-note.test.mjs',
  ];
  for (const f of files) {
    const src = read(f);
    const n = src.split('\n').length;
    assert.ok(n > 20, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is ${n} lines`);
  }
  for (const f of files.slice(0, 7)) assert.doesNotMatch(read(f), /\bconsole\./, `${f} logs`);
  assert.match('console.log(x)', /\bconsole\./, 'control');
});
