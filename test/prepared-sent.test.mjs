// sow-481: an invitation can be marked SENT, and the superadmin manager became its own Invitations tab with lanes.
// The record transitions and their claim-path invariance, the two Worker ops, the manager's lane rules, the admin
// page that hosts it, and the one-time launch stamp. No network: every dependency is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  LISTING_STATE, listingMarkSent, listingUnmarkSent, listingResend, listingRevoke, carrySent, listingSummary,
  publicListingView, claimDecision, listingKey,
} from '../membership/prepared-listings.mjs';
import { inviteKey } from '../membership/invites.mjs';
import { membershipPreparedPost } from '../workers/signup/membership-prepared-admin.mjs';
import {
  PREPARED_ACTION, PREPARED_LANE, preparedLane, preparedLanes, preparedLaneSummary, preparedWaited, preparedIsSent,
  preparedActions, preparedRowMeta,
} from '../client-ui/src/prepared-listings-core.mjs';
import { STAMP, launchStampFor, launchStamped, stampLaunchSent, parseArgs } from '../scripts/stamp-invitations-sent.mjs';
import * as F from './prepared-claim-fixtures.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = F.NOW;
const LATER = new Date(NOW.getTime() + 6 * 86400e3);
const listingOf = (kv) => kv.json(listingKey(F.LISTING_ID));

// ---- the record --------------------------------------------------------------------------------------------------

test('mark sent records who and when, only while prepared, and a second press changes nothing', () => {
  const { listing } = F.seed();
  const r = listingMarkSent(listing, { by: F.PREPARER, byLogin: 'atwellpub', now: NOW });
  assert.ok(r.ok && r.changed);
  assert.equal(r.next.sentAt, NOW.toISOString());
  assert.equal(r.next.sentBy, F.PREPARER);
  assert.equal(r.next.sentByLogin, 'atwellpub');
  assert.equal(r.next.sentAtLaunch, false);
  assert.equal(r.next.updatedAt, listing.updatedAt, 'updatedAt is the edit token and does not move');
  const again = listingMarkSent(r.next, { by: '1', byLogin: 'someone', now: LATER });
  assert.equal(again.changed, false);
  assert.equal(again.next.sentByLogin, 'atwellpub', 'the first who and when are kept');
  assert.equal(listingMarkSent({ ...listing, sentAtLaunch: true }, { now: NOW }).changed, false, 'a launch stamp already counts as sent');

  const revoked = listingRevoke(listing, { now: NOW }).next;
  assert.equal(listingMarkSent(revoked, { now: NOW }).error, 'not_sendable', 'a revoked link is dead');
  assert.equal(listingMarkSent({ ...listing, claimPendingAt: NOW.toISOString(), claimPendingBy: F.CLAIMANT }, { now: NOW }).error, 'not_sendable');
  assert.equal(listingMarkSent({ ...listing, claimedAt: NOW.toISOString(), claimedBy: F.CLAIMANT }, { now: NOW }).error, 'not_sendable');
});

test('not sent yet clears all four fields, a launch stamp included, and only while prepared', () => {
  const { listing } = F.seed();
  const sent = listingMarkSent(listing, { by: F.PREPARER, byLogin: 'atwellpub', now: NOW }).next;
  const back = listingUnmarkSent(sent);
  assert.ok(back.ok && back.changed);
  assert.deepEqual([back.next.sentAt, back.next.sentBy, back.next.sentByLogin, back.next.sentAtLaunch], [null, null, null, false]);
  assert.equal(back.next.updatedAt, listing.updatedAt);
  assert.equal(listingUnmarkSent(back.next).changed, false);
  assert.equal(listingUnmarkSent({ ...listing, sentAtLaunch: true }).next.sentAtLaunch, false);
  assert.equal(listingUnmarkSent(listingRevoke(sent, { now: NOW }).next).error, 'not_sendable');
});

test('send again makes a new link nobody has been sent', () => {
  const { listing } = F.seed();
  const sent = listingMarkSent(listing, { by: F.PREPARER, byLogin: 'atwellpub', now: NOW }).next;
  const again = listingResend(listingRevoke(sent, { now: NOW }).next, { code: 'NEWCODE22', now: LATER });
  assert.ok(again.ok);
  assert.deepEqual([again.next.sentAt, again.next.sentBy, again.next.sentByLogin, again.next.sentAtLaunch], [null, null, null, false]);
});

test('the manager row carries when and the LOGIN of who sent it, never the account number', () => {
  const { listing, invite } = F.seed();
  const sent = listingMarkSent(listing, { by: F.PREPARER, byLogin: 'atwellpub', now: NOW }).next;
  const s = listingSummary(sent, invite, NOW);
  assert.equal(s.sentAt, NOW.toISOString());
  assert.equal(s.sentByLogin, 'atwellpub');
  assert.equal(s.sentAtLaunch, false);
  assert.ok(!('sentBy' in s));
  assert.ok(!JSON.stringify(s).includes(F.PREPARER), 'no account number anywhere in the row');
  const blank = listingSummary(listing, invite, NOW);
  assert.deepEqual([blank.sentAt, blank.sentByLogin, blank.sentAtLaunch], [null, null, false], 'an old record reads as unsent');
});

// The property that justifies a field over a new state: nothing on the claim side can tell a sent invitation from
// an unsent one. Every branch the decision can reach is walked with and without the fields.
test('claimDecision and the public view answer exactly the same with and without the sent fields', () => {
  const { listing, invite } = F.seed();
  const variants = [
    {},
    { sentAt: NOW.toISOString(), sentBy: F.PREPARER, sentByLogin: 'atwellpub', sentAtLaunch: false },
    { sentAt: null, sentBy: null, sentByLogin: null, sentAtLaunch: true },
  ];
  const cases = [
    { claimantId: F.CLAIMANT, effective: { status: 'paid', source: 'stripe' }, yearRefusal: null },
    { claimantId: F.CLAIMANT, effective: { status: 'paid', source: 'coupon' }, yearRefusal: null },
    { claimantId: F.CLAIMANT, effective: { status: 'none', source: null }, yearRefusal: null },
    { claimantId: F.CLAIMANT, effective: { status: 'none', source: null }, yearRefusal: 'already_redeemed' },
    { claimantId: F.CLAIMANT, effective: { status: 'banned' }, yearRefusal: null },
    { claimantId: F.PREPARER, effective: { status: 'paid', source: 'staff' }, yearRefusal: null },
    { claimantId: 'not-a-number', effective: { status: 'paid' }, yearRefusal: null },
  ];
  const listings = [
    listing,
    { ...listing, boundGithubId: F.STRANGER, boundLogin: 'other' },
    { ...listing, claimPendingAt: NOW.toISOString(), claimPendingBy: F.CLAIMANT },
    { ...listing, claimedAt: NOW.toISOString(), claimedBy: F.CLAIMANT },
    listingRevoke(listing, { now: NOW }).next,
  ];
  let compared = 0;
  for (const base of listings) {
    for (const c of cases) {
      const answers = variants.map((v) => JSON.stringify(claimDecision({ invite, listing: { ...base, ...v }, now: NOW, ...c })));
      assert.equal(new Set(answers).size, 1, `claimDecision moved with the sent fields: ${answers.join(' | ')}`);
      compared += 1;
    }
    const views = variants.map((v) => JSON.stringify(publicListingView({ ...base, ...v }, invite, NOW)));
    assert.equal(new Set(views).size, 1, 'the public view never shows the sent fields');
  }
  assert.equal(compared, listings.length * cases.length);
});

test('carrySent takes the sent fields from the fresher read and nothing else', () => {
  const next = { id: 'x', message: 'edited', sentAt: null, sentAtLaunch: false };
  const fresh = { id: 'x', message: 'old', sentAt: NOW.toISOString(), sentBy: F.PREPARER, sentByLogin: 'atwellpub', sentAtLaunch: false };
  assert.deepEqual(carrySent(next, fresh), { id: 'x', message: 'edited', sentAt: NOW.toISOString(), sentBy: F.PREPARER, sentByLogin: 'atwellpub', sentAtLaunch: false });
  assert.deepEqual(carrySent({ id: 'x', sentAt: NOW.toISOString() }, {}), { id: 'x', sentAt: null, sentBy: null, sentByLogin: null, sentAtLaunch: false });
});

// ---- the Worker ops ----------------------------------------------------------------------------------------------

const req = (body) => new Request('https://x/membership/admin/prepared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const superadmin = async () => ({ ok: true, githubId: F.PREPARER, role: 'superadmin', mirror: { roles: { superadmins: [{ github_id: F.PREPARER, login: 'atwellpub' }] } } });
const op = (kv, body, over = {}) => membershipPreparedPost(req(body), { SIGNUP_KV: kv }, {
  authorize: superadmin, now: NOW, getToken: async () => 'tok', siteBase: 'https://gbti.network',
  readTree: async () => ({ content: [], shares: [] }), loadHouse: async () => ({ ok: true, parsed: F.TAXONOMY }),
  lookupUser: async () => ({ ok: false, status: 404 }), ...over,
});

test('the ops are superadmin only: a refused caller reads and writes nothing', async () => {
  const { kv } = F.seed();
  const before = kv.store.get(listingKey(F.LISTING_ID));
  for (const name of ['mark-sent', 'unmark-sent']) {
    const r = await op(kv, { op: name, id: F.LISTING_ID }, { authorize: async () => ({ ok: false, status: 403, body: { error: 'forbidden' } }) });
    assert.equal(r.status, 403);
  }
  assert.equal(kv.store.get(listingKey(F.LISTING_ID)), before);
  assert.equal(kv.puts.length, 0);
});

test('mark sent writes who and when to the listing only; the invitation is untouched; unmark puts it back', async () => {
  const { kv } = F.seed();
  const invBefore = kv.store.get(inviteKey(F.CODE));
  const updatedAt = listingOf(kv).updatedAt;
  let r = await op(kv, { op: 'mark-sent', id: F.LISTING_ID });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.changed, true);
  assert.equal(r.body.listing.sentAt, NOW.toISOString());
  assert.equal(r.body.listing.sentByLogin, 'atwellpub', 'the login comes from the roles mirror');
  assert.equal(listingOf(kv).sentBy, F.PREPARER, 'the record keeps the account number; the row does not');
  assert.equal(listingOf(kv).updatedAt, updatedAt);
  assert.equal(kv.store.get(inviteKey(F.CODE)), invBefore, 'being sent is about the listing, not the year');
  r = await op(kv, { op: 'mark-sent', id: F.LISTING_ID }, { now: LATER });
  assert.equal(r.body.changed, false);
  assert.equal(listingOf(kv).sentAt, NOW.toISOString());
  r = await op(kv, { op: 'unmark-sent', id: F.LISTING_ID });
  assert.equal(r.status, 200);
  assert.equal(r.body.listing.sentAt, null);
  assert.equal(listingOf(kv).sentAt, null);
});

test('a bad id is 400, an unknown one 404, and publishing, claimed and revoked listings are 409', async () => {
  const { kv } = F.seed();
  assert.equal((await op(kv, { op: 'mark-sent', id: '../x' })).status, 400);
  assert.equal((await op(kv, { op: 'mark-sent', id: 'ZZZZZZZZZZZZZZZZ' })).status, 404);
  for (const over of [
    { claimPendingAt: NOW.toISOString(), claimPendingBy: F.CLAIMANT },
    { claimedAt: NOW.toISOString(), claimedBy: F.CLAIMANT },
    { revokedAt: NOW.toISOString(), revokedBy: F.PREPARER },
  ]) {
    const s = F.seed({ listingOver: over });
    for (const name of ['mark-sent', 'unmark-sent']) {
      const r = await op(s.kv, { op: name, id: F.LISTING_ID });
      assert.equal(r.status, 409, `${name} on ${JSON.stringify(over)}`);
      assert.equal(r.body.error, 'not_sendable');
    }
    assert.equal(s.kv.puts.length, 0);
  }
});

test('the listing is read again before the write: a claim taken meanwhile is kept, a new code is refused', async () => {
  // A claim that took its lock between the op's first read and its write.
  const a = F.seed();
  const getA = a.kv.get.bind(a.kv);
  let reads = 0;
  a.kv.get = async (key, type) => {
    const v = await getA(key, type);
    if (key === listingKey(F.LISTING_ID) && ++reads === 1) {
      a.kv.store.set(key, JSON.stringify({ ...JSON.parse(a.kv.store.get(key)), claimPendingAt: NOW.toISOString(), claimPendingBy: F.CLAIMANT }));
    }
    return v;
  };
  const r = await op(a.kv, { op: 'mark-sent', id: F.LISTING_ID });
  assert.equal(r.status, 409);
  assert.equal(listingOf(a.kv).claimPendingBy, F.CLAIMANT, 'the lock survives');
  assert.equal(listingOf(a.kv).sentAt ?? null, null);

  // A Send again that minted a new code meanwhile.
  const b = F.seed();
  const getB = b.kv.get.bind(b.kv);
  let readsB = 0;
  b.kv.get = async (key, type) => {
    const v = await getB(key, type);
    if (key === listingKey(F.LISTING_ID) && ++readsB === 1) {
      b.kv.store.set(key, JSON.stringify({ ...JSON.parse(b.kv.store.get(key)), code: 'ANOTHERCODE2345' }));
    }
    return v;
  };
  const r2 = await op(b.kv, { op: 'mark-sent', id: F.LISTING_ID });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error, 'listing_changed');
  assert.equal(listingOf(b.kv).sentAt ?? null, null);
});

test('an edit saved while Mark sent lands keeps the mark, and Mark sent never refuses an open edit', async () => {
  // The edit copies the listing (its `current`), then reads the invitation, writes images and so on, then re-reads
  // and writes. The mark is landed in exactly that gap: on the first invitation read after the edit took its copy.
  const { kv } = F.seed();
  const get = kv.get.bind(kv);
  let listingReads = 0;
  let marked = null;
  let busy = false;
  kv.get = async (key, type) => {
    if (!busy) {
      if (key === listingKey(F.LISTING_ID)) listingReads += 1;
      if (!marked && key === inviteKey(F.CODE) && listingReads >= 2) {
        busy = true;
        marked = await op(kv, { op: 'mark-sent', id: F.LISTING_ID });
        busy = false;
      }
    }
    return get(key, type);
  };
  const r = await op(kv, { op: 'save', id: F.LISTING_ID, message: 'An updated message.', draft: F.DRAFT({ title: 'Renamed' }) });
  assert.ok(marked, 'the mark never fired inside the edit; this test measures nothing');
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(r.status, 200, `the edit was refused: ${JSON.stringify(r.body)}`);
  assert.equal(listingOf(kv).frontmatter.title, 'Renamed', 'the edit landed');
  assert.equal(listingOf(kv).sentAt, NOW.toISOString(), 'and the mark that landed during it was not erased');
  assert.equal(r.body.listing.sentAt, NOW.toISOString(), 'the row the edit returns says so too');
});

test('the dispatcher names the new ops, and the adapter sends them', () => {
  const src = read('workers/signup/membership-prepared-admin.mjs');
  assert.match(src, /case 'mark-sent': return sentListingOp\(body, ctx, true\);/);
  assert.match(src, /case 'unmark-sent': return sentListingOp\(body, ctx, false\);/);
  assert.match(src, /next = carrySent\(next, again\.rec\);\n\s*if \(!\(await writeListing\(kv, next\)\)\)/, 'the edit carries the sent fields right before its write');
});

// ---- the lanes ---------------------------------------------------------------------------------------------------

const ID = 'ABCDEFGHJKMNPQRS';
const row = (over = {}) => ({
  id: ID, slug: 'surfacedby', title: 'SurfacedBy', recipientName: 'Sam', bound: false, campaign: 'SPRING', code: 'SPRINGABCDEFGHJK',
  priorCodes: [], state: 'prepared', preparedByLogin: 'atwellpub', createdAt: '2026-10-05T12:00:00.000Z',
  sentAt: null, sentByLogin: null, sentAtLaunch: false, ...over,
});
const SENT = { sentAt: '2026-10-20T09:00:00.000Z', sentByLogin: 'atwellpub' };
const TODAY = new Date('2026-10-26T15:00:00.000Z');

test('every state has a lane: unsent and revoked wait to be sent, sent waits on a reply, the rest landed', () => {
  assert.equal(preparedLane(row()), PREPARED_LANE.ready);
  assert.equal(preparedLane(row(SENT)), PREPARED_LANE.sent);
  assert.equal(preparedLane(row({ sentAtLaunch: true })), PREPARED_LANE.sent);
  assert.equal(preparedLane(row({ state: 'revoked' })), PREPARED_LANE.ready, 'owner, 2026-10-26: its next step is Send again');
  assert.equal(preparedLane(row({ state: 'publishing' })), PREPARED_LANE.landed);
  assert.equal(preparedLane(row({ state: 'claimed' })), PREPARED_LANE.landed);
  assert.equal(preparedLane(row({ state: 'claimed', ...SENT })), PREPARED_LANE.landed, 'once accepted, sent stops mattering');
  assert.equal(preparedLane(row({ state: 'weird' })), PREPARED_LANE.unreadable);
  assert.equal(preparedLane(row({ corrupt: true })), PREPARED_LANE.unreadable);
  assert.equal(preparedLane(null), PREPARED_LANE.unreadable);
  assert.equal(preparedIsSent(row({ sentAt: '' })), false);
});

test('the lanes keep the Worker order, put revoked after the unsent ones, and never drop a row', () => {
  const rows = [
    row({ id: 'A', state: 'revoked' }), row({ id: 'B' }), row({ id: 'C', ...SENT }), row({ id: 'D', state: 'claimed' }),
    row({ id: 'E' }), row({ id: 'F', state: 'weird' }), row({ id: 'G', state: 'publishing' }),
  ];
  const lanes = preparedLanes(rows);
  assert.deepEqual(lanes.ready.map((r) => r.id), ['B', 'E', 'A']);
  assert.deepEqual(lanes.sent.map((r) => r.id), ['C']);
  assert.deepEqual(lanes.landed.map((r) => r.id), ['D', 'G']);
  assert.deepEqual(lanes.unreadable.map((r) => r.id), ['F']);
  assert.equal(Object.values(lanes).flat().length, rows.length);
  assert.equal(preparedLaneSummary(lanes), '3 ready to send · 1 sent and waiting · 2 landed · 1 unreadable');
  assert.equal(preparedLaneSummary(preparedLanes([])), '0 ready to send · 0 sent and waiting · 0 landed');
  assert.deepEqual(preparedLanes(null), { ready: [], sent: [], landed: [], unreadable: [] });
});

test('how long it has waited is plain words, counted from the send, or from preparing for a launch stamp', () => {
  assert.equal(preparedWaited(row(SENT), TODAY), 'Waiting 6 days');
  assert.equal(preparedWaited(row({ sentAt: '2026-10-25T16:00:00.000Z' }), TODAY), 'Sent today', 'under a day');
  assert.equal(preparedWaited(row({ sentAt: '2026-10-25T09:00:00.000Z' }), TODAY), 'Waiting 1 day');
  assert.equal(preparedWaited(row({ sentAtLaunch: true }), TODAY), '21 days since prepared');
  assert.equal(preparedWaited(row({ sentAtLaunch: true, createdAt: '2026-10-26T01:00:00.000Z' }), TODAY), 'Prepared today');
  assert.equal(preparedWaited(row({ sentAt: '2026-12-01T00:00:00.000Z' }), TODAY), 'Sent today', 'a clock behind the record never goes negative');
  assert.equal(preparedWaited(row(), TODAY), '', 'not in the sent lane');
  assert.equal(preparedWaited(row({ state: 'claimed', ...SENT }), TODAY), '');
  assert.equal(preparedWaited(row({ sentAt: 'garbage' }), TODAY), '');
  assert.equal(preparedWaited(row({ sentAt: '2025-01-01T00:00:00.000Z' }), TODAY), 'Waiting 663 days', 'no threshold: a year is still just a number');
});

test('Mark sent is offered on an unsent live link only, and Not sent yet on a sent one only; Copy link marks nothing', () => {
  const { copy, markSent, edit, revoke, unmarkSent, remove } = PREPARED_ACTION;
  assert.deepEqual(preparedActions(row()), [copy, markSent, edit, revoke, remove]);
  assert.deepEqual(preparedActions(row(SENT)), [copy, edit, revoke, unmarkSent, remove]);
  assert.deepEqual(preparedActions(row({ sentAtLaunch: true })), [copy, edit, revoke, unmarkSent, remove]);
  assert.deepEqual(preparedActions(row({ code: null })), [edit, revoke, remove], 'no link, nothing to have sent');
  for (const st of ['revoked', 'publishing', 'claimed', 'weird']) {
    const acts = preparedActions(row({ state: st, ...SENT }));
    assert.ok(!acts.includes(markSent) && !acts.includes(unmarkSent), `${st} offers neither`);
  }
  const el = read('client-ui/src/elements/gbti-prepared-listings.mjs');
  const copyBranch = el.slice(el.indexOf("if (act === 'copy') {"), el.indexOf("if (act === 'delete')"));
  assert.ok(copyBranch.length > 100, 'the copy branch moved; this assertion measures nothing');
  assert.doesNotMatch(copyBranch, /preparedMarkSent|_run\(/, 'Copy link and Mark sent are separate controls (owner, 2026-10-26)');
});

test('the row facts say who sent it and when, or that it was counted at launch', () => {
  assert.ok(preparedRowMeta(row(SENT)).includes('Sent 2026-10-20 by @atwellpub'));
  assert.ok(preparedRowMeta(row({ sentAtLaunch: true })).includes('Counted as sent at launch'));
  assert.ok(!preparedRowMeta(row()).some((m) => m.startsWith('Sent ') || m.startsWith('Counted')));
  assert.ok(!preparedRowMeta(row({ state: 'claimed', ...SENT })).some((m) => m.startsWith('Sent 2026')), 'a landed row is past being sent');
  assert.deepEqual(preparedRowMeta(row({ corrupt: true })), [], 'an unreadable record states nothing about itself');
  assert.deepEqual(preparedRowMeta(row({ state: 'weird' })), []);
});

test('nothing flags a quiet invitation: no overdue wording, no warning colour on a sent card', () => {
  for (const f of ['client-ui/src/prepared-listings-core.mjs', 'client-ui/src/elements/gbti-prepared-listings.mjs']) {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /overdue|no reply|chase/i, `${f} has flagging wording`);
  }
  const el = read('client-ui/src/elements/gbti-prepared-listings.mjs');
  const css = el.slice(el.indexOf('const CSS = `'), el.indexOf('`;', el.indexOf('const CSS = `')));
  for (const rule of css.match(/[^}]*\.pl-st\.sent[^}]*\}/g) || []) assert.doesNotMatch(rule, /danger/, 'the Sent pill is neutral');
  assert.match(css, /\.pl-card\.accent \{[^}]*border-left:3px solid[^}]*border-radius:0 10px 10px 0;/, 'a coloured left border squares its left corners');
  assert.match(el, /const accent = lane === 'ready' && st === 'prepared' \? ' accent' : '';/, 'only an unsent invitation carries the accent bar');
});

// ---- the home: its own tab ---------------------------------------------------------------------------------------

test('Invitations is its own superadmin tab, and the coupon manager no longer carries the listings', () => {
  const page = read('src/pages/admin.astro');
  assert.match(page, /<button type="button" role="tab" data-tab="invitations" data-min="superadmin" aria-selected="false" hidden>Invitations<\/button>/);
  assert.match(page, /<div class="adm-card" data-panel="invitations" hidden>\s*<h2 class="h2">Invitations<\/h2>\s*<gbti-prepared-listings><\/gbti-prepared-listings>/);
  const superBlock = page.slice(page.indexOf('if (rank >= RANK.superadmin) {'), page.indexOf('setupTabs(rank);'));
  assert.ok(superBlock.length > 100, 'the superadmin import block moved; this assertion measures nothing');
  assert.match(superBlock, /await import\('\.\.\/\.\.\/client-ui\/src\/elements\/gbti-prepared-listings\.mjs'\);/, 'imported for a superadmin only');
  assert.equal((page.match(/gbti-prepared-listings\.mjs/g) || []).length, 1, 'and nowhere else on the page');
  const coupons = read('client-ui/src/elements/gbti-coupon-manager.mjs');
  assert.doesNotMatch(coupons, /gbti-prepared-listings|data-prepared-slot|_prepEl/);
  assert.match(read('client-ui/src/index.mjs'), /import '\.\/elements\/gbti-prepared-listings\.mjs';/, 'still in the shared bundle');
  assert.match(read('scripts/check-load-retry.mjs'), /\['gbti-prepared-listings', 'preparedList', '\.pl-lanes'\]/, 'the load-retry harness drives it in its new home');
});

test('the element reads the coupon registry itself, in the same single load as the listings', () => {
  const src = read('client-ui/src/elements/gbti-prepared-listings.mjs');
  const load = src.slice(src.indexOf('  async load() {'), src.indexOf('  render() {'));
  assert.match(load, /client\.preparedList\(\)/);
  assert.match(load, /client\.couponPool\(\)/);
  assert.match(load, /await Promise\.all\(/, 'one load, both reads');
  assert.doesNotMatch(src, /set coupons\(/, 'no host hands it the registry any more');
  assert.equal((src.match(/couponPool\(/g) || []).length, 1);
});

// ---- the launch stamp --------------------------------------------------------------------------------------------

const CUTOFF = new Date('2026-10-27T00:00:00.000Z');

test('launchStampFor: only an unsent prepared listing created before the cutoff', () => {
  const { listing } = F.seed();
  assert.equal(launchStampFor(listing, CUTOFF), STAMP.stamp);
  assert.equal(launchStampFor({ ...listing, createdAt: '2026-10-27T00:00:00.000Z' }, CUTOFF), STAMP.afterCutoff);
  assert.equal(launchStampFor({ ...listing, createdAt: null }, CUTOFF), STAMP.noDate);
  assert.equal(launchStampFor({ ...listing, sentAt: NOW.toISOString() }, CUTOFF), STAMP.alreadySent);
  assert.equal(launchStampFor({ ...listing, sentAtLaunch: true }, CUTOFF), STAMP.alreadySent);
  assert.equal(launchStampFor({ ...listing, revokedAt: NOW.toISOString() }, CUTOFF), STAMP.notPrepared);
  assert.equal(launchStampFor({ ...listing, claimPendingAt: NOW.toISOString() }, CUTOFF), STAMP.notPrepared);
  assert.equal(launchStampFor({ ...listing, claimedAt: NOW.toISOString() }, CUTOFF), STAMP.notPrepared);
  assert.equal(launchStampFor(null, CUTOFF), STAMP.notPrepared);
  const stamped = launchStamped(listing);
  assert.deepEqual([stamped.sentAt, stamped.sentBy, stamped.sentByLogin, stamped.sentAtLaunch], [null, null, null, true], 'no invented date or sender');
  assert.equal(stamped.updatedAt, listing.updatedAt);
});

function stampKv() {
  const base = F.seed().listing;
  const at = (id, over) => [listingKey(id), JSON.stringify({ ...base, id, ...over })];
  return F.fakeKv(Object.fromEntries([
    at('AAAAAAAAAAAAAAAA', {}),                                                    // old, unsent: stamped
    at('BBBBBBBBBBBBBBBB', { sentAt: NOW.toISOString(), sentByLogin: 'atwellpub' }), // already sent
    at('CCCCCCCCCCCCCCCC', { claimedAt: NOW.toISOString(), claimedBy: F.CLAIMANT }), // landed
    at('DDDDDDDDDDDDDDDD', { revokedAt: NOW.toISOString() }),                      // revoked
    at('EEEEEEEEEEEEEEEE', { createdAt: '2026-10-28T00:00:00.000Z' }),             // after the cutoff
    at('FFFFFFFFFFFFFFFF', {}),                                                    // old, unsent: stamped
    ['invite-listing-img:AAAAAAAAAAAAAAAA:icon.png', JSON.stringify({ dataBase64: 'x' })],
    [inviteKey(F.CODE), JSON.stringify(F.seed().invite)],
  ]));
}

test('a dry run reports what it would stamp and writes nothing', async () => {
  const kv = stampKv();
  const r = await stampLaunchSent({ kv, cutoff: CUTOFF });
  assert.deepEqual(r.stamped, ['AAAAAAAAAAAAAAAA', 'FFFFFFFFFFFFFFFF']);
  assert.equal(r.listed, 6, 'images and invites are not listings');
  assert.deepEqual(r.counts, { stamp: 2, already_sent: 1, not_prepared: 2, after_cutoff: 1 });
  assert.equal(kv.puts.length, 0);
});

test('--apply stamps exactly those, a second run stamps nothing, and a record that changed meanwhile is left', async () => {
  const kv = stampKv();
  const before = kv.store.get(listingKey('BBBBBBBBBBBBBBBB'));
  const r = await stampLaunchSent({ kv, cutoff: CUTOFF, apply: true });
  assert.deepEqual(r.stamped, ['AAAAAAAAAAAAAAAA', 'FFFFFFFFFFFFFFFF']);
  assert.deepEqual(kv.puts, [listingKey('AAAAAAAAAAAAAAAA'), listingKey('FFFFFFFFFFFFFFFF')]);
  assert.equal(kv.json(listingKey('AAAAAAAAAAAAAAAA')).sentAtLaunch, true);
  assert.equal(kv.store.get(listingKey('BBBBBBBBBBBBBBBB')), before);
  const again = await stampLaunchSent({ kv, cutoff: CUTOFF, apply: true });
  assert.deepEqual(again.stamped, []);
  assert.equal(kv.puts.length, 2, 'idempotent');

  const raced = stampKv();
  const get = raced.get.bind(raced);
  let n = 0;
  raced.get = async (key, type) => {
    if (key === listingKey('AAAAAAAAAAAAAAAA') && ++n === 2) {
      raced.store.set(key, JSON.stringify({ ...raced.json(key), claimPendingAt: NOW.toISOString(), claimPendingBy: F.CLAIMANT }));
    }
    return get(key, type);
  };
  const rr = await stampLaunchSent({ kv: raced, cutoff: CUTOFF, apply: true });
  assert.deepEqual(rr.raced, ['AAAAAAAAAAAAAAAA']);
  assert.equal(raced.json(listingKey('AAAAAAAAAAAAAAAA')).claimPendingBy, F.CLAIMANT, 'the claim lock is not overwritten');
  assert.deepEqual(rr.stamped, ['FFFFFFFFFFFFFFFF']);
});

test('an unreadable record is reported and left; a missing cutoff refuses; --apply needs saying', async () => {
  const kv = stampKv();
  const get = kv.get.bind(kv);
  kv.get = async (key, type) => { if (key === listingKey('FFFFFFFFFFFFFFFF')) throw new Error('KV read failed'); return get(key, type); };
  const r = await stampLaunchSent({ kv, cutoff: CUTOFF, apply: true });
  assert.deepEqual(r.unreadable, ['FFFFFFFFFFFFFFFF']);
  assert.deepEqual(r.stamped, ['AAAAAAAAAAAAAAAA']);
  await assert.rejects(stampLaunchSent({ kv, cutoff: new Date('nope') }));
  assert.deepEqual(parseArgs([]), { apply: false, before: null }, 'dry run is the default');
  assert.deepEqual(parseArgs(['--apply', '--dry-run']), { apply: false, before: null }, '--dry-run wins');
  assert.deepEqual(parseArgs(['--apply', '--before', '2026-10-27']), { apply: true, before: '2026-10-27' });
});

test('the stamp prints ids and counts only: never a name, a message or a code', () => {
  const src = read('scripts/stamp-invitations-sent.mjs');
  // The report lines. The two error lines print a thrown message and a bad --before value, neither of which is a record.
  const printed = src.split('\n').filter((l) => /console\.log/.test(l)).join('\n');
  assert.ok(printed.length > 200, 'the output lines moved; this assertion measures nothing');
  assert.doesNotMatch(printed, /\.code\b|recipientName|message\b|\.title\b|rec\b|fresh\b/);
});
