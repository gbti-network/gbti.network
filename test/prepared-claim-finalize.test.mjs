// sow-427 C4: finalizing a claim (workers/signup/prepared-claim-finalize.mjs), the scheduled sweep that does it with
// nobody watching (prepared-claim-sweep.mjs, amendment 2), the manager's finalize hook, and the GitHub pull request
// readers in hosted-commit.mjs they rely on.
//
// The property every test here guards: a claim lock ends ONLY on a fact from GitHub. Merged makes the claim (the
// invite can never grant a year again), closed-unmerged releases it, open or unreadable changes nothing, and a lock
// with no pull request at all is released only once it is long past the claim that took it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  finalizeIfMerged, finalizeListingById, takeClaim, releaseClaim, recordOpenedPr, stripClaimDetails, ORPHAN_LOCK_MS, FINALIZE_STATE,
} from '../workers/signup/prepared-claim-finalize.mjs';
import { sweepPreparedClaims, sweepDue, sweepBatch, SWEEP_MAX_PER_TICK, SWEEP_EVERY_MINUTES } from '../workers/signup/prepared-claim-sweep.mjs';
import { preparedFinalizeHook } from '../workers/signup/membership-claim.mjs';
import { readPull, findPullByBranch, readRepoText } from '../workers/signup/hosted-commit.mjs';
import { resolveRedeemable } from '../workers/signup/coupons.mjs';
import { inviteKey, inviteState, INVITE_STATE } from '../membership/invites.mjs';
import { listingKey, listingImageKey, listingState, LISTING_STATE, isListingId } from '../membership/prepared-listings.mjs';
import { NOW, CLAIMANT, STRANGER, LISTING_ID, CODE, CAMPAIGN, UPSTREAM, seed, fakeKv, ghFake, pull } from './prepared-claim-fixtures.mjs';

const listingOf = (kv, id = LISTING_ID) => kv.json(listingKey(id));
const inviteOf = (kv) => kv.json(inviteKey(CODE));
const imageKeys = (kv) => [...kv.store.keys()].filter((k) => k.startsWith('invite-listing-img:'));
const deps = (kv, fetchImpl, over = {}) => ({ kv, fetchImpl, getToken: async () => 'inst-token', now: NOW, upstream: UPSTREAM, siteBase: 'https://gbti.network', ...over });

/** A listing locked by CLAIMANT (as the claim POST leaves it), optionally with its pull request number. */
async function locked({ prNumber = 77, lockedAt = NOW, ...seedOpts } = {}) {
  const s = seed(seedOpts);
  const t = await takeClaim(s.kv, { listingId: LISTING_ID, code: CODE, githubId: CLAIMANT, details: { folder: 'sam', login: 'Sam-Dev' }, expectUpdatedAt: s.listing.updatedAt, now: lockedAt });
  assert.ok(t.ok, JSON.stringify(t));
  if (prNumber) assert.ok(await recordOpenedPr(s.kv, { listingId: LISTING_ID, code: CODE, githubId: CLAIMANT, prNumber, details: { folder: 'sam', login: 'Sam-Dev' }, now: lockedAt }));
  return { kv: s.kv, listing: listingOf(s.kv), invite: inviteOf(s.kv) };
}

test('finalize MERGED: invite claimed (no year ever again), images deleted, listing claimed + minimized, ONE notify', async () => {
  const { kv, listing, invite } = await locked();
  const gh = ghFake([], { pulls: new Map([[77, pull(77, { state: 'closed', merged: true })]]) });
  const f = await finalizeIfMerged({}, { listing, invite }, deps(kv, gh));
  assert.equal(f.state, FINALIZE_STATE.claimed);
  assert.equal(f.projectUrl, 'https://gbti.network/projects/surfacedby/');
  assert.ok(f.notify);
  assert.equal(f.notify.claimedLogin, 'Sam-Dev');
  assert.equal(f.notify.prUrl, `https://github.com/${UPSTREAM}/pull/77`);

  const i = inviteOf(kv);
  assert.equal(inviteState(i, NOW), INVITE_STATE.claimed);
  assert.equal(i.claimedBy, CLAIMANT);
  const kvWithCoupons = kv;
  kvWithCoupons.store.set('coupons:config', JSON.stringify({ generatedAt: NOW.toISOString(), coupons: [{ code: CAMPAIGN, freeDays: 365, active: true, tier: 'member' }] }));
  assert.deepEqual(await resolveRedeemable(kvWithCoupons, CODE, NOW), { coupon: null, invite: null }, 'a claimed invite resolves to nothing');

  const l = listingOf(kv);
  assert.equal(listingState(l), LISTING_STATE.claimed);
  assert.equal(l.claimedBy, CLAIMANT);
  assert.equal(l.claimedFolder, 'sam');
  assert.equal(l.claimedPath, 'members/sam/projects/surfacedby/index.md');
  assert.equal(l.frontmatter, null);
  assert.equal(l.body, null);
  assert.equal(l.message, null, 'the personal message does not outlive the claim');
  assert.deepEqual(l.images, []);
  assert.equal(l.title, 'SurfacedBy', 'the manager still names it');
  assert.ok(!('claimPendingFolder' in l) && !('claimPendingLogin' in l));
  assert.deepEqual(imageKeys(kv), []);

  const again = await finalizeIfMerged({}, { listing: l, invite: i }, deps(kv, gh));
  assert.equal(again.state, FINALIZE_STATE.claimed);
  assert.equal(again.notify, null, 'idempotent: exactly one notice');
  assert.equal(listingOf(kv).claimedAt, l.claimedAt, 'the claim time is never rewritten');
});

test('finalize CLOSED unmerged: the lock and the pending claim are released, and the person can try again', async () => {
  const { kv, listing, invite } = await locked();
  const gh = ghFake([], { pulls: new Map([[77, pull(77, { state: 'closed', merged: false })]]) });
  const f = await finalizeIfMerged({}, { listing, invite }, deps(kv, gh));
  assert.equal(f.state, FINALIZE_STATE.failed);
  assert.equal(f.releasedFor, CLAIMANT);
  assert.equal(f.notify, null);
  assert.equal(listingState(listingOf(kv)), LISTING_STATE.prepared);
  assert.equal(listingOf(kv).prNumber, null);
  assert.ok(!('claimPendingFolder' in listingOf(kv)));
  assert.equal(inviteState(inviteOf(kv), NOW), INVITE_STATE.issued);
  assert.equal(imageKeys(kv).length, 3, 'the prepared images stay for the retry');
});

test('finalize OPEN or UNREADABLE: nothing changes, however old the lock (no expiry while a pull request is open)', async () => {
  const { kv, listing, invite } = await locked({ lockedAt: new Date(NOW.getTime() - 30 * 86400e3) });
  const before = JSON.stringify([listingOf(kv), inviteOf(kv)]);
  const open = await finalizeIfMerged({}, { listing, invite }, deps(kv, ghFake([], { pulls: new Map([[77, pull(77)]]) })));
  assert.equal(open.state, FINALIZE_STATE.publishing);
  const down = await finalizeIfMerged({}, { listing, invite }, deps(kv, ghFake([], { failPullRead: true })));
  assert.equal(down.state, FINALIZE_STATE.publishing, 'GitHub could not say: the lock stays');
  const noToken = await finalizeIfMerged({}, { listing, invite }, deps(kv, ghFake([]), { getToken: async () => { throw new Error('x'); } }));
  assert.equal(noToken.state, FINALIZE_STATE.publishing);
  assert.equal(JSON.stringify([listingOf(kv), inviteOf(kv)]), before);
});

test('finalize: a number the claim could not store is found by the HEAD BRANCH and recorded', async () => {
  const { kv, listing, invite } = await locked({ prNumber: null });
  const gh = ghFake([], { byBranch: [pull(90)] });
  const f = await finalizeIfMerged({}, { listing, invite }, deps(kv, gh));
  assert.equal(f.state, FINALIZE_STATE.publishing);
  assert.equal(f.prNumber, 90);
  assert.equal(new URL(gh.headQueries[0]).searchParams.get('head'), `gbti-network:hosted/${CLAIMANT}/project-surfacedby`);
  assert.equal(listingOf(kv).prNumber, 90);
  assert.equal(inviteOf(kv).claimPr, 90);
});

test('finalize: an OLDER closed pull request on the branch (an earlier attempt) never releases the current lock', async () => {
  const old = pull(12, { state: 'closed', merged: false, createdAt: new Date(NOW.getTime() - 86400e3).toISOString() });
  const young = await locked({ prNumber: null });
  const f = await finalizeIfMerged({}, { listing: young.listing, invite: young.invite }, deps(young.kv, ghFake([], { byBranch: [old] })));
  assert.equal(f.state, FINALIZE_STATE.publishing, 'the current claim may still be opening its pull request');
  assert.equal(listingState(listingOf(young.kv)), LISTING_STATE.publishing);
});

test('finalize: a lock with NO pull request is released only after ORPHAN_LOCK_MS', async () => {
  const { kv, listing, invite } = await locked({ prNumber: null });
  const gh = ghFake([], { byBranch: [] });
  const soon = await finalizeIfMerged({}, { listing, invite }, deps(kv, gh, { now: new Date(NOW.getTime() + ORPHAN_LOCK_MS - 1000) }));
  assert.equal(soon.state, FINALIZE_STATE.publishing);
  const late = await finalizeIfMerged({}, { listing, invite }, deps(kv, gh, { now: new Date(NOW.getTime() + ORPHAN_LOCK_MS + 1000) }));
  assert.equal(late.state, FINALIZE_STATE.failed);
  assert.equal(listingState(listingOf(kv)), LISTING_STATE.prepared);
  assert.equal(inviteState(inviteOf(kv), NOW), INVITE_STATE.issued);
});

test('finalize MERGED with a failed image delete retries: the invite is claimed at once, the listing on the retry', async () => {
  const s = await locked();
  let fail = true;
  const kv = fakeKv(Object.fromEntries(s.kv.store), { failDelete: (k) => fail && k.startsWith('invite-listing-img:') });
  const gh = ghFake([], { pulls: new Map([[77, pull(77, { state: 'closed', merged: true })]]) });
  const first = await finalizeIfMerged({}, { listing: s.listing, invite: s.invite }, deps(kv, gh));
  assert.equal(first.state, FINALIZE_STATE.publishing);
  assert.equal(first.notify, null);
  assert.equal(inviteState(inviteOf(kv), NOW), INVITE_STATE.claimed, 'the year is closed off before anything else');
  assert.equal(listingState(listingOf(kv)), LISTING_STATE.publishing, 'never minimized while images remain');
  fail = false;
  const second = await finalizeListingById({}, LISTING_ID, deps(kv, gh));
  assert.equal(second.state, FINALIZE_STATE.claimed);
  assert.ok(second.notify);
  assert.deepEqual(imageKeys(kv), []);
});

test('finalize heals a stale pending claim left on an invite whose listing was released', async () => {
  const s = seed({ inviteOver: { claimPendingAt: NOW.toISOString(), claimPendingBy: CLAIMANT, claimPr: 5 } });
  const f = await finalizeIfMerged({}, { listing: s.listing, invite: s.invite }, deps(s.kv, ghFake([])));
  assert.equal(f.state, FINALIZE_STATE.unchanged);
  assert.equal(inviteState(inviteOf(s.kv), NOW), INVITE_STATE.issued);
});

test('takeClaim refuses an edited listing, a lock held by another account, and a second lock by the same one', async () => {
  const s = seed();
  const changed = await takeClaim(s.kv, { listingId: LISTING_ID, code: CODE, githubId: CLAIMANT, details: { folder: 'sam' }, expectUpdatedAt: 'stale', now: NOW });
  assert.deepEqual(changed, { ok: false, error: 'changed' });
  assert.equal(listingState(listingOf(s.kv)), LISTING_STATE.prepared, 'nothing was locked');
  const mine = await takeClaim(s.kv, { listingId: LISTING_ID, code: CODE, githubId: CLAIMANT, details: { folder: 'sam' }, expectUpdatedAt: s.listing.updatedAt, now: NOW });
  assert.ok(mine.ok);
  assert.deepEqual(await takeClaim(s.kv, { listingId: LISTING_ID, code: CODE, githubId: STRANGER, details: { folder: 'x' }, expectUpdatedAt: listingOf(s.kv).updatedAt, now: NOW }), { ok: false, error: 'locked' });
  assert.deepEqual(await takeClaim(s.kv, { listingId: LISTING_ID, code: CODE, githubId: CLAIMANT, details: { folder: 'sam' }, expectUpdatedAt: listingOf(s.kv).updatedAt, now: NOW }), { ok: false, error: 'publishing' });
  // A bound invite never takes a lock for another account, even past the decision.
  const b = seed({ bound: CLAIMANT });
  const other = await takeClaim(b.kv, { listingId: LISTING_ID, code: CODE, githubId: STRANGER, details: { folder: 'x' }, expectUpdatedAt: b.listing.updatedAt, now: NOW });
  assert.deepEqual(other, { ok: false, error: 'inactive' });
  assert.equal(listingState(listingOf(b.kv)), LISTING_STATE.prepared, 'the listing lock was released again');
  const rel = await releaseClaim(s.kv, { listing: listingOf(s.kv), invite: inviteOf(s.kv), githubId: CLAIMANT });
  assert.ok(rel.ok);
  assert.equal(stripClaimDetails(rel.listing), rel.listing);
});

const WINDOW_MS = SWEEP_EVERY_MINUTES * 60 * 1000;
const EXTRA_IDS = ['3456789ABCDEFGHJ', '456789ABCDEFGHJK', '56789ABCDEFGHJKM', '6789ABCDEFGHJKMN', '789ABCDEFGHJKMNP', '89ABCDEFGHJKMNPQ', '9ABCDEFGHJKMNPQR'];

/** `count` publishing listings: the fixture's own (the oldest lock), then copies locked one second apart. */
async function publishingWorld(count) {
  const s = await locked();
  for (const [n, id] of EXTRA_IDS.slice(0, count - 1).entries()) {
    assert.ok(isListingId(id));
    s.kv.store.set(listingKey(id), JSON.stringify({ ...s.listing, id, claimPendingAt: new Date(NOW.getTime() + (n + 1) * 1000).toISOString() }));
  }
  return s;
}

test('sweep: only on the quarter-hour tick, at most SWEEP_MAX_PER_TICK, oldest first, and it returns COUNTS ONLY', async () => {
  assert.equal(sweepDue(new Date('2026-10-01T12:00:10Z')), true);
  assert.equal(sweepDue(new Date('2026-10-01T12:15:40Z')), true);
  assert.equal(sweepDue(new Date('2026-10-01T12:05:00Z')), false);
  assert.equal(sweepDue(new Date('2026-10-01T12:40:00Z')), false);
  assert.deepEqual(await sweepPreparedClaims({}, { now: new Date('2026-10-01T12:05:00Z'), kv: fakeKv() }), { ran: false });

  const s = await publishingWorld(7);
  // A clock whose window puts the rotation cursor at the head of the list, so this run takes the five OLDEST. The
  // rotation itself is pinned by the next test.
  const aligned = new Date(Math.floor(NOW.getTime() / (7 * WINDOW_MS)) * 7 * WINDOW_MS);
  const seen = [];
  const sent = [];
  const out = await sweepPreparedClaims({}, {
    kv: s.kv, now: aligned,
    finalize: async (_env, { listing }) => { seen.push(listing.id); return listing.id === LISTING_ID ? { state: 'claimed', notify: { title: 'SurfacedBy' } } : { state: 'publishing' }; },
    sendAlert: async (_env, rec) => { sent.push(rec); return { sent: true }; },
  });
  assert.equal(seen.length, SWEEP_MAX_PER_TICK, 'bounded');
  assert.equal(seen[0], LISTING_ID, 'oldest lock first');
  assert.deepEqual(out, { ran: true, scanned: 7, publishing: 7, checked: 5, claimed: 1, failed: 0, open: 4, notified: 1, errors: 0 });
  assert.equal(sent.length, 1);
  for (const v of Object.values(out)) assert.ok(typeof v === 'number' || typeof v === 'boolean', 'counts only: nothing identifying is logged');
});

// TRAP (review F3): five claims stuck open (a gate error nothing re-gates, a merge conflict, a failing check) used to
// take every run, because the sweep always took the five OLDEST. A newer claim that merged after its claimant closed
// the tab was then never finalized: no owner notice, its message kept, its images kept.
test('sweep: with more stuck claims than one run takes, consecutive windows still reach EVERY publishing listing', async () => {
  for (const count of [6, 7]) {
    const s = await publishingWorld(count);
    const ids = new Set();
    const windows = Math.ceil(count / SWEEP_MAX_PER_TICK);
    for (let w = 0; w < windows; w += 1) {
      const out = await sweepPreparedClaims({}, {
        kv: s.kv, now: new Date(NOW.getTime() + w * WINDOW_MS), force: true,
        finalize: async (_env, { listing }) => { ids.add(listing.id); return { state: 'publishing' }; },
      });
      assert.equal(out.checked, SWEEP_MAX_PER_TICK, 'still bounded per run');
      assert.equal(out.open, SWEEP_MAX_PER_TICK);
    }
    assert.equal(ids.size, count, `${count} stuck claims: all of them checked within ${windows} windows, the newest included`);
    assert.ok(ids.has(EXTRA_IDS[count - 2]), 'the newest claim is reached');
  }
});

test('sweepBatch: everything oldest first when it fits; otherwise a wrapping run of max that consecutive windows walk', () => {
  const at = (w) => new Date(w * WINDOW_MS);
  assert.deepEqual(sweepBatch(['a', 'b', 'c'], 5, at(3)), ['a', 'b', 'c'], 'no rotation when every listing fits');
  for (let n = SWEEP_MAX_PER_TICK + 1; n <= 13; n += 1) {
    const list = Array.from({ length: n }, (_, i) => `L${i}`);
    for (const startWin of [0, 1, 1989840, 1989841]) {
      const seen = new Set();
      for (let w = 0; w < Math.ceil(n / SWEEP_MAX_PER_TICK); w += 1) {
        const batch = sweepBatch(list, SWEEP_MAX_PER_TICK, at(startWin + w));
        assert.equal(batch.length, SWEEP_MAX_PER_TICK);
        assert.equal(new Set(batch).size, SWEEP_MAX_PER_TICK, 'no listing twice in one run');
        for (const x of batch) seen.add(x);
      }
      assert.equal(seen.size, n, `n=${n} from window ${startWin}`);
    }
  }
  assert.deepEqual(sweepBatch(null, 5, at(1)), []);
});

test('sweep: drives the real finalize end to end, and a throwing finalize is a count, not a crash', async () => {
  const s = await locked();
  const gh = ghFake([], { pulls: new Map([[77, pull(77, { state: 'closed', merged: true })]]) });
  const sent = [];
  const out = await sweepPreparedClaims({ UPSTREAM_REPO: UPSTREAM }, {
    kv: s.kv, now: NOW, force: true,
    finalize: (env, x, d) => finalizeIfMerged(env, x, { ...d, fetchImpl: gh, getToken: async () => 'inst-token' }),
    sendAlert: async (_e, rec) => { sent.push(rec); return { sent: true }; },
  });
  assert.equal(out.claimed, 1);
  assert.equal(listingState(listingOf(s.kv)), LISTING_STATE.claimed);
  assert.equal(sent.length, 1);
  const boom = await sweepPreparedClaims({}, { kv: (await locked()).kv, now: NOW, finalize: async () => { throw new Error('secret title'); } });
  assert.equal(boom.errors, 1);
  assert.deepEqual(await sweepPreparedClaims({}, { now: NOW, kv: { list: async () => { throw new Error('x'); } } }), { ran: true, unavailable: true });
});

test('the manager hook finalizes a row and sends its notice through ctx.waitUntil', async () => {
  const { kv, listing, invite } = await locked();
  const gh = ghFake([], { pulls: new Map([[77, pull(77, { state: 'closed', merged: true })]]) });
  const waited = [];
  const sent = [];
  const hook = preparedFinalizeHook({}, { waitUntil: (p) => waited.push(p) }, {
    ...deps(kv, gh), sendAlert: async (_e, rec) => { sent.push(rec); return { sent: true }; },
  });
  const r = await hook({ listing, invite });
  await Promise.all(waited);
  assert.equal(waited.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(listingState(r.listing), LISTING_STATE.claimed);
  assert.equal(inviteState(r.invite, NOW), INVITE_STATE.claimed);
});

test('hosted-commit readers: a pull request by number, by head branch, and a file that may not exist', async () => {
  const gh = ghFake([], {
    profile: true,
    pulls: new Map([[5, pull(5, { state: 'closed', merged: true })]]),
    byBranch: [pull(3, { state: 'closed' }), pull(8), { number: 9, head: { ref: 'hosted/1/other' } }],
  });
  const io = { fetchImpl: gh, instToken: 't', upstream: UPSTREAM };
  const one = await readPull({ ...io, number: 5 });
  assert.equal(one.ok, true);
  assert.equal(one.pr.merged, true);
  assert.equal(one.pr.headRef, `hosted/${CLAIMANT}/project-surfacedby`);
  assert.deepEqual(await readPull({ ...io, number: 404 }), { ok: true, pr: null });
  assert.deepEqual(await readPull({ ...io, fetchImpl: ghFake([], { failPullRead: true }), number: 5 }), { ok: false, status: 502 });
  const found = await findPullByBranch({ ...io, branch: `hosted/${CLAIMANT}/project-surfacedby` });
  assert.equal(found.pr.number, 8, 'the OPEN pull request wins over a closed one');
  assert.equal((await findPullByBranch({ ...io, fetchImpl: async () => { throw new Error('x'); }, branch: 'b' })).ok, false);
  const prof = await readRepoText({ ...io, path: 'members/sam/profile.md' });
  assert.equal(prof.ok, true);
  assert.match(prof.text, /username: sam/);
  assert.deepEqual(await readRepoText({ ...io, fetchImpl: ghFake([]), path: 'members/sam/profile.md' }), { ok: true, text: null });
  assert.equal((await readRepoText({ ...io, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }), path: 'x' })).ok, false, 'unreadable is never "absent"');
});
