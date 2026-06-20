// SOW-029 / SOW-050: the build-time members directory builder behind /members-index.json. Verifies data
// minimization (follow-card fields + the public social links subset for the reader author drawer; still NO
// github_id/email/location) + the github-avatar fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMembersDirectory } from '../src/lib/members-directory.mjs';

const P = (data) => ({ data });

test('emits the minimized fields + the public links subset (no leaked github_id/email/location)', () => {
  const profiles = [
    P({ username: 'alice', displayName: 'Alice', avatar: 'https://gravatar/x', headline: 'Dev', tier: 'paid', location: 'NYC', links: { github: 'https://github.com/aliceGH', discord: 'alice#1', secret: 'nope' } }),
  ];
  const out = buildMembersDirectory(profiles, (login) => `gh://${login}`);
  assert.deepEqual(Object.keys(out[0]).sort(), ['avatar', 'displayName', 'headline', 'links', 'tier', 'username']);
  assert.equal(out[0].avatar, 'https://gravatar/x', 'a gravatar wins over the github fallback');
  assert.ok(!('location' in out[0]), 'location does not leak');
  assert.deepEqual(out[0].links, { github: 'https://github.com/aliceGH', discord: 'alice#1' }, 'only the known link keys (incl. discord) survive; unknown keys dropped');
});

test('omits links entirely when the profile has none (or only blanks/unknown keys)', () => {
  const out = buildMembersDirectory([
    P({ username: 'noL', tier: 'paid' }),
    P({ username: 'blankL', tier: 'paid', links: { discord: '  ', mystery: 'x' } }),
  ]);
  assert.ok(!('links' in out[0]), 'no links object when the profile has no links');
  assert.ok(!('links' in out[1]), 'no links object when only blanks/unknown keys are present');
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
