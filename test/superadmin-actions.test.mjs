// SOW-038: the pure superadmin governance action core. Tests cover idempotency, role switching, anti-mutation
// (the input is never changed), the audit shape, and input validation. No fs / no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grantRole, revokeRole, ban, unban, grandfather, revokeGrandfather, hideContent, unhideContent,
  SuperadminActionError,
} from '../membership/superadmin-actions.mjs';

const NOW = new Date('2026-06-17T00:00:00Z');
const ACTOR = { githubId: '2002207', login: 'atwellpub' };
const ctx = { actor: ACTOR, now: NOW };
const roles = () => ({ superadmins: [{ github_id: '2002207', login: 'atwellpub' }], admins: [], moderators: [] });

test('grantRole: member -> admin adds to admins; idempotent on re-grant', () => {
  const r1 = grantRole(roles(), { githubId: '500', login: 'casey', role: 'admin' }, ctx);
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.next.admins, [{ github_id: '500', login: 'casey' }]);
  assert.equal(r1.audit.action, 'role.grant');
  assert.deepEqual(r1.audit.target, { github_id: '500', login: 'casey' });
  assert.equal(r1.audit.detail.role, 'admin');
  // re-grant the same role -> no change
  const r2 = grantRole(r1.next, { githubId: '500', login: 'casey', role: 'admin' }, ctx);
  assert.equal(r2.changed, false);
});

test('grantRole: switching admin -> superadmin removes the old listing (exactly one role)', () => {
  const start = { superadmins: [{ github_id: '2002207' }], admins: [{ github_id: '500', login: 'casey' }], moderators: [] };
  const r = grantRole(start, { githubId: '500', login: 'casey', role: 'superadmin' }, ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(r.next.admins, []);
  assert.ok(r.next.superadmins.some((e) => e.github_id === '500'));
});

test('grantRole(member) and revokeRole both remove from every privileged list', () => {
  const start = { superadmins: [], admins: [{ github_id: '500' }], moderators: [{ github_id: '500' }] };
  const a = grantRole(start, { githubId: '500', role: 'member' }, ctx);
  assert.deepEqual(a.next.admins, []);
  assert.deepEqual(a.next.moderators, []);
  const b = revokeRole(start, { githubId: '500' }, ctx);
  assert.deepEqual(b.next.admins, []);
  assert.equal(b.audit.action, 'role.revoke');
});

test('grantRole: unknown role + missing githubId throw', () => {
  assert.throws(() => grantRole(roles(), { githubId: '1', role: 'wizard' }, ctx), SuperadminActionError);
  assert.throws(() => grantRole(roles(), { role: 'admin' }, ctx), SuperadminActionError);
});

test('ban / unban are idempotent and identity-minimal', () => {
  const b = ban({ bans: [] }, { githubId: '900', login: 'mallory', reason: 'spam' }, ctx);
  assert.equal(b.changed, true);
  assert.equal(b.next.bans[0].github_id, '900');
  assert.equal(b.next.bans[0].reason, 'spam');
  assert.equal(b.next.bans[0].at, NOW.toISOString());
  // re-ban -> no change
  assert.equal(ban(b.next, { githubId: '900' }, ctx).changed, false);
  // an empty / whitespace reason falls back to the default (not a blank reason)
  const blank = ban({ bans: [] }, { githubId: '901', reason: '   ' }, ctx);
  assert.equal(blank.next.bans[0].reason, 'banned');
  assert.equal(blank.audit.detail.reason, 'banned');
  // unban removes
  const u = unban(b.next, { githubId: '900' }, ctx);
  assert.deepEqual(u.next.bans, []);
  assert.equal(u.changed, true);
  assert.equal(unban(u.next, { githubId: '900' }, ctx).changed, false);
});

test('grandfather: adds permanent grant, updates on change, rejects a bad until', () => {
  const g = grandfather({ grandfathered: [] }, { githubId: '225425', login: 'rfilipo' }, ctx);
  assert.equal(g.changed, true);
  assert.deepEqual(g.next.grandfathered[0], { github_id: '225425', login: 'rfilipo', reason: 'complimentary access', until: null });
  // identical re-grant -> no change
  assert.equal(grandfather(g.next, { githubId: '225425', login: 'rfilipo' }, ctx).changed, false);
  // changing until -> change
  const g2 = grandfather(g.next, { githubId: '225425', login: 'rfilipo', until: '2027-01-01' }, ctx);
  assert.equal(g2.changed, true);
  assert.equal(g2.next.grandfathered[0].until, '2027-01-01');
  assert.throws(() => grandfather({ grandfathered: [] }, { githubId: '1', until: 'not-a-date' }, ctx), SuperadminActionError);
  // revoke
  const rv = revokeGrandfather(g2.next, { githubId: '225425' }, ctx);
  assert.deepEqual(rv.next.grandfathered, []);
  assert.equal(rv.audit.action, 'grandfather.revoke');
});

test('hideContent flips to draft + members; unhide restores published; idempotent', () => {
  const h = hideContent({ status: 'published', visibility: 'public', title: 'X' }, { path: 'members/a/posts/x/index.md' }, ctx);
  assert.equal(h.changed, true);
  assert.equal(h.next.status, 'draft');
  assert.equal(h.next.visibility, 'members');
  assert.equal(h.next.title, 'X'); // other fields preserved
  assert.equal(h.audit.action, 'content.hide');
  assert.equal(h.audit.detail.path, 'members/a/posts/x/index.md');
  assert.equal(hideContent(h.next, {}, ctx).changed, false); // already hidden
  const u = unhideContent(h.next, {}, ctx);
  assert.equal(u.next.status, 'published');
});

test('the audit entry is well-formed and the input is never mutated', () => {
  const start = roles();
  const snapshot = JSON.stringify(start);
  const r = grantRole(start, { githubId: '777', login: 'newbie', role: 'moderator' }, ctx);
  assert.equal(JSON.stringify(start), snapshot, 'input roles must not be mutated');
  assert.equal(r.audit.at, NOW.toISOString());
  assert.deepEqual(r.audit.actor, { github_id: '2002207', login: 'atwellpub' });
  assert.equal(typeof r.audit.action, 'string');
});
