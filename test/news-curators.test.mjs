// SOW-046 C: the pure news-CURATOR governance helpers, in BOTH the node-free Worker core (overrides-core.mjs)
// and the client mirror (client/src/roles.mjs). A curator may publish a members-only news item to Discord; the
// capability is orthogonal to the member<moderator<admin<superadmin ladder (admin/superadmin inherit it; a
// roles.yml curators: listing grants it to a plain member) and never affects effectiveStatus / content gating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  curatorsFromParsed, isCurator, canCurateNews as coreCanCurate,
  effectiveStatus, rolesFromParsed, bansFromParsed, grandfathersFromParsed,
} from '../membership/overrides-core.mjs';
import { curatorsFromText, canCurateNews as clientCanCurate, ROLE } from '../client/src/roles.mjs';

test('curatorsFromParsed: builds a Set of curator ids and skips the M0 placeholder', () => {
  const set = curatorsFromParsed({ curators: [{ github_id: '5' }, { github_id: 'REPLACE_AT_M0' }, '6'] });
  assert.equal(isCurator('5', set), true);
  assert.equal(isCurator('6', set), true);
  assert.equal(isCurator('REPLACE_AT_M0', set), false);
  assert.equal(isCurator('9', set), false);
  assert.equal(curatorsFromParsed({}).size, 0);
});

test('canCurateNews (core): admin + superadmin inherit; an explicit curator passes; nobody else', () => {
  assert.equal(coreCanCurate(ROLE.admin, false), true);
  assert.equal(coreCanCurate(ROLE.superadmin, false), true);
  assert.equal(coreCanCurate(ROLE.moderator, false), false);
  assert.equal(coreCanCurate(ROLE.member, false), false);
  assert.equal(coreCanCurate(ROLE.member, true), true); // curator grant to a plain member
});

test('the client mirror matches the Worker core', () => {
  const set = curatorsFromText('curators:\n  - github_id: "5"\n');
  assert.equal(set.has('5'), true);
  assert.equal(clientCanCurate(ROLE.member, set.has('5')), true);
  assert.equal(clientCanCurate(ROLE.member, set.has('9')), false);
  assert.equal(clientCanCurate(ROLE.admin, false), true);
  // unparseable -> nobody is a curator
  assert.equal(curatorsFromText('!!!: [').size, 0);
  assert.equal(curatorsFromText('').size, 0);
});

test('the curator grant does NOT touch effectiveStatus (it is not a membership tier)', () => {
  const overrides = {
    roles: rolesFromParsed({ superadmins: [], admins: [], moderators: [] }),
    bans: bansFromParsed({ bans: [] }),
    grandfathers: grandfathersFromParsed({ grandfathered: [] }),
  };
  // a plain member who is a curator still derives from Stripe (here: none), NOT paid
  const r = effectiveStatus('5', 'none', overrides);
  assert.equal(r.status, 'none');
  assert.equal(r.source, 'stripe');
});
