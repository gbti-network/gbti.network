// SOW-011: the client-side publish-eligibility (membership.mjs) + the operations.publish choke point.
// Pure, no network: the status oracle + the host reader are injected. Mirrors the gate's precedence so the
// client blocks exactly the publishes the gate would reject.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  effectiveMembership,
  canPublish,
  canSeeNews,
  canFollow,
  canSave,
  canBrowse,
  isBlockedFromPublishing,
  isLockedMembership,
  bannedIdsFromText,
  grandfathersFromText,
  grandfatherActive,
  fetchStripeStatus,
  resolveMembership,
} from '../client/src/membership.mjs';
import { publish, getStatus, OperationError } from '../client/src/operations.mjs';

// ---- effectiveMembership precedence (ban > staff > grandfather > stripe) ----
test('effectiveMembership folds the git overrides with the gate precedence', () => {
  const roles = new Map([['10', 'admin']]);
  const banned = new Set(['20']);
  const grandfathers = new Map([['30', { github_id: '30' }]]);
  // plain Stripe statuses pass through
  assert.equal(effectiveMembership({ githubId: '1', stripeStatus: 'paid' }), 'paid');
  assert.equal(effectiveMembership({ githubId: '1', stripeStatus: 'trialing' }), 'trialing');
  assert.equal(effectiveMembership({ githubId: '1', stripeStatus: 'none' }), 'none');
  // staff is paid-equivalent even with no sub
  assert.equal(effectiveMembership({ githubId: '10', stripeStatus: 'expired', roles }), 'paid');
  // grandfather is paid-equivalent even with no sub
  assert.equal(effectiveMembership({ githubId: '30', stripeStatus: 'none', grandfathers }), 'paid');
  // a ban overrides everything (even a paid sub, even staff)
  assert.equal(effectiveMembership({ githubId: '20', stripeStatus: 'paid', banned }), 'banned');
  assert.equal(effectiveMembership({ githubId: '20', stripeStatus: 'paid', roles: new Map([['20', 'admin']]), banned }), 'banned');
  // missing oracle -> unknown
  assert.equal(effectiveMembership({ githubId: '1' }), 'unknown');
});

test('canPublish + isBlockedFromPublishing: only paid publishes; unknown is not blocked (fails open)', () => {
  assert.equal(canPublish('paid'), true);
  for (const s of ['trialing', 'expired', 'cancelled', 'none', 'banned', 'unknown']) assert.equal(canPublish(s), false);
  for (const s of ['trialing', 'expired', 'cancelled', 'none', 'banned']) assert.equal(isBlockedFromPublishing(s), true);
  assert.equal(isBlockedFromPublishing('paid'), false);
  assert.equal(isBlockedFromPublishing('unknown'), false); // unknown fails OPEN to the gate
});

test('override parsers tolerate missing/garbage text and read the github_id lists', () => {
  assert.deepEqual([...bannedIdsFromText('bans:\n  - github_id: "5"\n  - 6\n')].sort(), ['5', '6']);
  assert.deepEqual([...bannedIdsFromText(null)], []);
  assert.deepEqual([...bannedIdsFromText(': not yaml :')], []);
  const g = grandfathersFromText('grandfathered:\n  - github_id: "7"\n  - github_id: "8"\n    until: "2020-01-01"\n');
  assert.ok(g.has('7'));
  assert.equal(grandfatherActive(g.get('7')), true); // no until -> active
  assert.equal(grandfatherActive(g.get('8')), false); // past until -> expired
  assert.equal(grandfatherActive(g.get('8'), new Date('2019-01-01').getTime()), true); // before until -> active
  assert.equal(grandfatherActive({ until: 'not-a-date' }), false); // unparseable -> fail closed
});

// ---- fetchStripeStatus: injected oracle, fails open on any error ----
test('fetchStripeStatus returns the oracle status, or unknown on any failure', async () => {
  const ok = await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: true, json: async () => ({ status: 'trialing' }) }) });
  assert.equal(ok, 'trialing');
  assert.equal(await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: false }) }), 'unknown');
  assert.equal(await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => { throw new Error('net'); } }), 'unknown');
  assert.equal(await fetchStripeStatus({ token: '', signupBase: 'https://s' }), 'unknown'); // no token -> no call
  assert.equal(await fetchStripeStatus({ token: 't', signupBase: '' }), 'unknown'); // no base -> no call
});

test('resolveMembership combines the oracle status with the reader overrides', async () => {
  const files = {
    'house/roles.yml': 'admins:\n  - github_id: "99"\n',
    'house/bans.yml': 'bans:\n  - github_id: "77"\n',
    'house/grandfathered.yml': 'grandfathered:\n  - github_id: "88"\n',
  };
  const readFile = (p) => files[p] ?? null;
  const fetch = async () => ({ ok: true, json: async () => ({ status: 'trialing' }) });
  // a plain trial member stays trial
  assert.deepEqual(await resolveMembership({ githubId: '1', token: 't', signupBase: 'https://s', readFile, fetch }), { stripeStatus: 'trialing', membership: 'trialing' });
  // staff -> paid despite the trial Stripe status
  assert.equal((await resolveMembership({ githubId: '99', token: 't', signupBase: 'https://s', readFile, fetch })).membership, 'paid');
  // grandfathered -> paid
  assert.equal((await resolveMembership({ githubId: '88', token: 't', signupBase: 'https://s', readFile, fetch })).membership, 'paid');
  // banned -> banned
  assert.equal((await resolveMembership({ githubId: '77', token: 't', signupBase: 'https://s', readFile, fetch })).membership, 'banned');
});

// ---- the operations.publish choke point ----
function ctxFor(membership) {
  const repoCalls = [];
  return {
    repoCalls,
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    membership: () => membership,
    store: { get: () => 'tok' },
    getRepoClient: () => ({
      upstream: 'gbti-network/gbti.network',
      ensureFork: async () => ({ full_name: 'alice/gbti.network', owner: 'alice' }),
      getDefaultBranch: async () => 'main',
      getBranchSha: async () => 'sha',
      ensureBranch: async () => {},
      getFileSha: async () => null,
      putFile: async (r, p) => repoCalls.push(p),
      findOpenPull: async () => null,
      openPull: async () => ({ number: 7, html_url: 'u' }),
    }),
  };
}

test('publish: a trial member is blocked with membership-required BEFORE any PR is opened', async () => {
  const ctx = ctxFor('trialing');
  await assert.rejects(
    () => publish(ctx, { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' }),
    (err) => {
      assert.ok(err instanceof OperationError);
      assert.equal(err.code, 'membership-required');
      assert.equal(err.details?.membership, 'trialing');
      return true;
    },
  );
  assert.deepEqual(ctx.repoCalls, [], 'no fork write / PR is attempted for a blocked member');
});

test('publish: a paid member publishes; an unknown membership fails OPEN to the gate', async () => {
  const paid = ctxFor('paid');
  const r1 = await publish(paid, { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' });
  assert.equal(r1.prNumber, 7);
  assert.deepEqual(paid.repoCalls, ['members/alice/posts/my-post/index.md']);

  const unknown = ctxFor('unknown'); // oracle unreachable -> do not block; the gate is the authority
  const r2 = await publish(unknown, { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' });
  assert.equal(r2.prNumber, 7);
});

test('getStatus surfaces membership + canPublish for the UI notice', () => {
  assert.deepEqual(
    (() => { const s = getStatus(ctxFor('trialing')); return { membership: s.membership, canPublish: s.canPublish }; })(),
    { membership: 'trialing', canPublish: false },
  );
  const paid = getStatus(ctxFor('paid'));
  assert.equal(paid.canPublish, true);
});

// SOW-060 + SOW-077: every known signed-in status (not banned) gets all the free perks. A BANNED account keeps the
// READ perk that needs no KV (browse: a static feed) but loses the KV "basket" (save/collect/follow) AND, for now,
// the gated news endpoint (canSeeNews opens to banned in Phase 2 with the Worker read-gate). canPublish stays paid.
test('free-tier predicates: known signed-in statuses get all perks; banned keeps browse but not the KV basket', () => {
  for (const m of ['paid', 'trialing', 'expired', 'cancelled', 'none']) {
    assert.equal(canSeeNews(m), true, `${m} sees news`);
    assert.equal(canFollow(m), true, `${m} follows`);
    assert.equal(canSave(m), true, `${m} saves`);
    assert.equal(canBrowse(m), true, `${m} browses`);
  }
  // SOW-077: a banned (community-banned) account stays a read-only user.
  assert.equal(canBrowse('banned'), true, 'banned may browse (static feed, no KV)');
  assert.equal(canSave('banned'), false, 'banned has no KV basket (save)');
  assert.equal(canFollow('banned'), false, 'banned has no KV basket (follow)');
  assert.equal(canSeeNews('banned'), false, 'banned: news gated until the Phase 2 read-gate');
  for (const m of ['unknown', undefined, null, '']) {
    assert.equal(canBrowse(m), false, `${m} browses nothing`);
    assert.equal(canSave(m), false, `${m} no KV`);
  }
});

// SOW-060 regression: opening the free perks must NOT open publishing. A free (none) member gets every perk but
// canPublish stays false; this guards against the predicate split accidentally widening canPublish. (The
// status-object WIRING regression that asserts getStatus surfaces these rides with the operations.mjs change.)
test('SOW-060 regression: a free (none) member follows + sees news + saves + browses but cannot publish', () => {
  assert.equal(canFollow('none'), true);
  assert.equal(canSeeNews('none'), true);
  assert.equal(canSave('none'), true);
  assert.equal(canBrowse('none'), true);
  assert.equal(canPublish('none'), false);
});

// SOW-018: the extension lock-splash predicate. Lapsed accounts lock; trial reads; paid is full; unknown fails OPEN.
test('isLockedMembership: only lapsed accounts lock the extension', () => {
  for (const m of ['expired', 'cancelled', 'none', 'banned']) assert.equal(isLockedMembership(m), true, `${m} locks`);
  for (const m of ['paid', 'trialing', 'unknown', undefined, null, '']) assert.equal(isLockedMembership(m), false, `${m} does NOT lock`);
});
