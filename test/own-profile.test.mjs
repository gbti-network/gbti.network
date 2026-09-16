// sow-346: the one safe read of the signed-in member's own profile. Anything that acts on "there is no profile"
// (the welcome step and the profile editor both create one) needs "absent" to mean the read answered "not found",
// and nothing else, or a failed read becomes a blank profile saved over a real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readOwnProfile } from '../client-ui/src/own-profile.mjs';

const notFound = () => Object.assign(new Error('no such item'), { code: 'not-found' });
function host(over = {}) {
  const asked = [];
  return {
    asked,
    status: async () => ({ identity: { login: 'Alice', username: 'alice' } }),
    listContent: async () => ({ items: [] }),
    getContentItem: async ({ path }) => { asked.push(path); return { frontmatter: { displayName: 'Alice' }, body: 'Bio' }; },
    ...over,
  };
}

test('found: the website shape (nothing listed) reads the member folder by username', async () => {
  const c = host();
  const r = await readOwnProfile(c);
  assert.equal(r.state, 'found');
  assert.equal(r.path, 'members/alice/profile.md');
  assert.deepEqual(r.item, { path: 'members/alice/profile.md', frontmatter: { displayName: 'Alice' }, body: 'Bio' });
  assert.deepEqual(c.asked, ['members/alice/profile.md']);
});

test('found: a host that lists the profile is read at the listed path, which wins over the username', async () => {
  const c = host({ listContent: async () => ({ items: [{ path: 'members/alice/profile.md' }] }), status: async () => ({ identity: null }) });
  assert.equal((await readOwnProfile(c)).state, 'found');
  const renamed = host({ listContent: async () => ({ items: [{ path: 'members/alice-old/profile.md' }] }) });
  assert.equal((await readOwnProfile(renamed)).path, 'members/alice-old/profile.md', 'the host knows where the file is');
});

test('absent: only when the read answered "not found"', async () => {
  const r = await readOwnProfile(host({ getContentItem: async () => { throw notFound(); } }));
  assert.deepEqual(r, { state: 'absent', path: 'members/alice/profile.md', item: null });
});

test('failed: every other outcome, so nothing downstream treats it as "no profile"', async () => {
  const cases = {
    'a thrown read': host({ getContentItem: async () => { throw Object.assign(new Error('github error 502'), { code: 'internal' }); } }),
    'a read with no code': host({ getContentItem: async () => { throw new Error('offline'); } }),
    'a host that answered nothing': host({ getContentItem: async () => null }),
    'no identity and nothing listed': host({ status: async () => { throw new Error('signed out'); } }),
    'no reader at all': host({ getContentItem: undefined }),
  };
  for (const [name, c] of Object.entries(cases)) assert.equal((await readOwnProfile(c)).state, 'failed', name);
  assert.equal((await readOwnProfile(null)).state, 'failed');
});

test('a listing that fails falls back to the member path rather than giving up', async () => {
  const r = await readOwnProfile(host({ listContent: async () => { throw new Error('index down'); } }));
  assert.equal(r.state, 'found');
});

test('a caller that already has the identity is not asked again', async () => {
  let asked = 0;
  const c = host({ status: async () => { asked++; return { identity: { username: 'zed' } }; } });
  const r = await readOwnProfile(c, { identity: { login: 'bob' } });
  assert.equal(asked, 0);
  assert.equal(r.path, 'members/bob/profile.md');
  assert.equal((await readOwnProfile(c, { identity: null })).state, 'failed', 'a known-empty identity is not looked up either');
});
