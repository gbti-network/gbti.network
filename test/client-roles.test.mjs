// SOW-006: role resolution in the client. The signed-in member's role decides which admin controls a screen
// SHOWS, which is UX only: the SOW-005 gate and CODEOWNERS are the real boundary, and the admin endpoint
// re-checks the role on every call.
//
// sow-274: the admin ORCHESTRATION that used to live here is gone with the client's writers. Role assignment
// and content moderation are performed by the network now, and their behaviour (the rank gates, what each
// action writes, idempotency, the refusals) is covered against the real endpoint in
// test/membership-admin-author.test.mjs, with the moderation path guard in test/security-fixes.test.mjs and
// the wiring census in test/admin-action-census.test.mjs. What is left here is the part that is still the
// client's own: reading house/roles.yml and answering what a role may do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rolesFromParsed, roleOf, canModerate, canBanGrandfather, canManageRoles } from '../client/src/roles.mjs';
import { loadRoles } from '../client/src/repo-fs.mjs';

test('roles: parse + rank + capability predicates', () => {
  const map = rolesFromParsed({ superadmins: [{ github_id: '1' }], admins: [{ github_id: '2' }], moderators: [{ github_id: '3' }] });
  assert.equal(roleOf('1', map), 'superadmin');
  assert.equal(roleOf('3', map), 'moderator');
  assert.equal(roleOf('99', map), 'member');
  assert.equal(canModerate('moderator'), true);
  assert.equal(canBanGrandfather('moderator'), false);
  assert.equal(canBanGrandfather('admin'), true);
  assert.equal(canManageRoles('admin'), false);
  assert.equal(canManageRoles('superadmin'), true);
});

test('roles: loadRoles from a local repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-roles-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'house', 'roles.yml'), 'superadmins:\n  - github_id: "1"\n    login: alice\n');
  assert.equal(roleOf('1', loadRoles(dir)), 'superadmin');
});
