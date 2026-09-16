// sow-183: canEditItem (relocated out of project-page.mjs now that every content-detail page uses it, not
// just projects). Tests carried over verbatim from their old home in test/product-page.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canEditItem, isOwnProfile } from '../src/lib/content-edit.mjs';

test('canEditItem: the owner (case-insensitive) may edit; a stranger may not', () => {
  assert.equal(canEditItem({ login: 'atwellpub', role: 'member' }, 'atwellpub'), true);
  assert.equal(canEditItem({ login: 'AtwellPub', role: 'member' }, 'atwellpub'), true); // login case differs
  assert.equal(canEditItem({ login: 'someoneelse', role: 'member' }, 'atwellpub'), false);
});

test('canEditItem: superadmin may edit any item, even one they do not own', () => {
  assert.equal(canEditItem({ login: 'gbtilabs', role: 'superadmin' }, 'atwellpub'), true);
  assert.equal(canEditItem({ login: null, role: 'superadmin' }, 'atwellpub'), true); // role alone is enough
});

test('canEditItem: signed out, or signed in with no matching login/role, sees no edit affordance', () => {
  assert.equal(canEditItem(null, 'atwellpub'), false);
  assert.equal(canEditItem({ login: 'atwellpub', role: 'admin' }, ''), false); // no owner to compare against
  assert.equal(canEditItem({ login: null, role: 'member' }, 'atwellpub'), false);
});

// sow-346: the profile page's "Edit profile" link opens the VIEWER's own profile, so only the page's member sees it.
test('isOwnProfile: only the member whose page it is, case-insensitive; never a superadmin on someone else\'s page', () => {
  assert.equal(isOwnProfile({ login: 'atwellpub', username: 'atwellpub' }, 'atwellpub'), true);
  assert.equal(isOwnProfile({ login: 'AtwellPub' }, 'atwellpub'), true, 'login case differs');
  assert.equal(isOwnProfile({ username: 'atwellpub' }, 'AtwellPub'), true);
  assert.equal(isOwnProfile({ login: 'gbtilabs', role: 'superadmin' }, 'atwellpub'), false, 'a superadmin would open their own profile');
  assert.equal(isOwnProfile({ login: 'someoneelse' }, 'atwellpub'), false);
  assert.equal(isOwnProfile(null, 'atwellpub'), false);
  assert.equal(isOwnProfile({ login: 'atwellpub' }, ''), false);
  assert.equal(isOwnProfile({ login: '' }, ''), false);
});
