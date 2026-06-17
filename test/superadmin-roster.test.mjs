// SOW-038 P2: the pure roster builder behind the superadmin dashboard. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster } from '../membership/superadmin-roster.mjs';

const parsed = {
  roles: { superadmins: [{ github_id: '1', login: 'sa' }], admins: [{ github_id: '2', login: 'ad' }], moderators: [] },
  bans: { bans: [{ github_id: '9', login: 'baddie' }] },
  grandfathered: { grandfathered: [{ github_id: '3', login: 'founder', until: null }, { github_id: '4', login: 'expired', until: '2000-01-01' }] },
  membersIndex: { members: { 1: 'sa', 2: 'ad', 3: 'founder', 4: 'expired', 5: 'plain', 9: 'baddie' } },
};

test('buildRoster enumerates the union of index + overrides with override-derived status', () => {
  const { roster, summary } = buildRoster(parsed, new Date('2026-06-17'));
  const by = Object.fromEntries(roster.map((r) => [r.githubId, r]));

  assert.equal(by['1'].role, 'superadmin');
  assert.equal(by['1'].status, 'paid');
  assert.equal(by['1'].source, 'staff');

  assert.equal(by['2'].role, 'admin');
  assert.equal(by['2'].source, 'staff');

  // active grandfather -> paid via grandfather
  assert.equal(by['3'].grandfathered, true);
  assert.equal(by['3'].status, 'paid');
  assert.equal(by['3'].source, 'grandfather');

  // expired grandfather -> not active, falls through to the unknown Stripe tier
  assert.equal(by['4'].grandfathered, false);
  assert.equal(by['4'].status, 'unknown');
  assert.equal(by['4'].source, 'stripe');

  // plain member, no override -> unknown (live Stripe not available here)
  assert.equal(by['5'].role, 'member');
  assert.equal(by['5'].status, 'unknown');
  assert.equal(by['5'].username, 'plain');

  // banned overrides everything
  assert.equal(by['9'].banned, true);
  assert.equal(by['9'].status, 'banned');
  assert.equal(by['9'].source, 'ban');

  assert.deepEqual(summary, { total: 6, staff: 2, grandfathered: 1, banned: 1, members: 2 });
});

test('a ban on a staff member still resolves to banned (precedence)', () => {
  const { roster } = buildRoster({
    roles: { superadmins: [{ github_id: '1' }], admins: [], moderators: [] },
    bans: { bans: [{ github_id: '1' }] },
    grandfathered: {}, membersIndex: { members: { 1: 'sa' } },
  });
  assert.equal(roster[0].status, 'banned');
  assert.equal(roster[0].source, 'ban');
  assert.equal(roster[0].role, 'superadmin'); // the role flag still reports, but status is banned
});

test('roster sorts staff -> grandfathered -> banned -> members', () => {
  const { roster } = buildRoster(parsed, new Date('2026-06-17'));
  const bands = roster.map((r) => (r.role !== 'member' ? 'staff' : r.grandfathered ? 'gf' : r.banned ? 'ban' : 'mem'));
  // staff entries come before the first non-staff, etc. (monotonic non-decreasing band)
  const order = { staff: 0, gf: 1, ban: 2, mem: 3 };
  for (let i = 1; i < bands.length; i++) assert.ok(order[bands[i]] >= order[bands[i - 1]], `band order at ${i}`);
});

test('stripeStatuses merge: real Stripe tier fills the non-override rows + enumerates pure-Stripe members', () => {
  const { roster, summary } = buildRoster({
    ...parsed,
    stripeStatuses: { 5: 'paid', 4: 'trialing', 8: 'expired' }, // 8 is pure-Stripe (no override, no index entry)
  }, new Date('2026-06-17'));
  const by = Object.fromEntries(roster.map((r) => [r.githubId, r]));

  // a plain member with a live paid sub -> status paid via stripe (not 'unknown')
  assert.equal(by['5'].status, 'paid');
  assert.equal(by['5'].source, 'stripe');
  assert.equal(by['5'].stripeStatus, 'paid');

  // expired grandfather (4) now falls through to the real Stripe tier (trialing), not 'unknown'
  assert.equal(by['4'].grandfathered, false);
  assert.equal(by['4'].status, 'trialing');

  // a pure-Stripe member (id 8, absent from every override file) is now enumerated
  assert.ok(by['8'], 'a Stripe-only member is listed');
  assert.equal(by['8'].status, 'expired');
  assert.equal(by['8'].username, null);

  // an override still wins over Stripe: the banned id stays banned, staff stays paid-via-staff
  assert.equal(by['9'].status, 'banned');
  assert.equal(by['1'].source, 'staff');
  assert.equal(summary.total, 7); // the 6 known + the pure-Stripe id 8
});

test('empty / missing inputs yield an empty roster, not a throw', () => {
  assert.deepEqual(buildRoster({}), { roster: [], summary: { total: 0, staff: 0, grandfathered: 0, banned: 0, members: 0 } });
  assert.deepEqual(buildRoster(), { roster: [], summary: { total: 0, staff: 0, grandfathered: 0, banned: 0, members: 0 } });
});
