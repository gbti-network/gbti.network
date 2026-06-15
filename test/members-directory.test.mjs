// SOW-029: the build-time members directory builder behind /members-index.json. Verifies data minimization
// (only the follow-card fields, no github_id/email/location/links) + the github-avatar fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMembersDirectory } from '../src/lib/members-directory.mjs';

const P = (data) => ({ data });

test('emits only the minimized field set (no leaked github_id/email/location/links)', () => {
  const profiles = [
    P({ username: 'alice', displayName: 'Alice', avatar: 'https://gravatar/x', headline: 'Dev', tier: 'paid', location: 'NYC', links: { github: 'https://github.com/aliceGH' } }),
  ];
  const out = buildMembersDirectory(profiles, (login) => `gh://${login}`);
  assert.deepEqual(Object.keys(out[0]).sort(), ['avatar', 'displayName', 'headline', 'tier', 'username']);
  assert.equal(out[0].avatar, 'https://gravatar/x', 'a gravatar wins over the github fallback');
  assert.ok(!('location' in out[0]) && !('links' in out[0]), 'no extra fields leak');
});

test('falls back to the github avatar (by login) when a profile has no gravatar', () => {
  const out = buildMembersDirectory([
    P({ username: 'bob', tier: 'trial', links: { github: 'bobgh' } }),     // bare handle
    P({ username: 'carol' }),                                              // no link -> login = username
  ], (login) => `gh://${login}`);
  assert.equal(out[0].avatar, 'gh://bobgh');
  assert.equal(out[0].displayName, 'bob', 'displayName falls back to username');
  assert.equal(out[1].avatar, 'gh://carol');
});

test('avatar is null when neither a gravatar nor a fallback resolves', () => {
  const out = buildMembersDirectory([P({ username: 'dave' })]); // default fallback returns undefined
  assert.equal(out[0].avatar, null);
});
