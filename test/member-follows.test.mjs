// SOW-023: the pure follow-graph core (membership/member-follows.mjs). Toggle, dedupe, normalize, validate,
// limit. No IO (injected now), so these are fast and deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFollows, normalizeUsername, normalizeFollows, applyFollow, followingUsernames, FollowError, MAX_FOLLOWING,
} from '../membership/member-follows.mjs';

const now = () => 1000;

test('normalizeUsername: lowercases, validates shape, rejects junk/paths', () => {
  assert.equal(normalizeUsername('AtwellPub'), 'atwellpub');
  assert.equal(normalizeUsername('di-kafei'), 'di-kafei');
  assert.equal(normalizeUsername('  Hudson  '), 'hudson');
  assert.equal(normalizeUsername('../etc'), null);
  assert.equal(normalizeUsername('a b'), null);
  assert.equal(normalizeUsername('-leading'), null);
  assert.equal(normalizeUsername('trailing-'), null);
  assert.equal(normalizeUsername(''), null);
  assert.equal(normalizeUsername('a'.repeat(40)), null);
  assert.equal(normalizeUsername(42), null);
});

test('applyFollow: adds a follow with a timestamp', () => {
  const f = applyFollow(emptyFollows(), { username: 'Alice', on: true }, { now });
  assert.deepEqual(f.following, [{ username: 'alice', addedAt: 1000 }]);
  assert.equal(f.updatedAt, 1000);
});

test('applyFollow: idempotent add (no duplicate), and remove', () => {
  let f = applyFollow(emptyFollows(), { username: 'alice', on: true }, { now });
  f = applyFollow(f, { username: 'alice', on: true }, { now });
  assert.equal(f.following.length, 1, 'no duplicate');
  f = applyFollow(f, { username: 'alice', on: false }, { now });
  assert.equal(f.following.length, 0, 'removed');
});

test('applyFollow: rejects an invalid username', () => {
  assert.throws(() => applyFollow(emptyFollows(), { username: '../x', on: true }, { now }), FollowError);
  assert.throws(() => applyFollow(emptyFollows(), { username: '', on: true }, { now }), FollowError);
});

test('applyFollow: enforces the following limit', () => {
  const following = Array.from({ length: MAX_FOLLOWING }, (_, i) => ({ username: `u${i}`, addedAt: 1 }));
  assert.throws(() => applyFollow({ following }, { username: 'newone', on: true }, { now }), /limit/);
  // toggling OFF an existing follow at the limit is still allowed
  assert.doesNotThrow(() => applyFollow({ following }, { username: 'u0', on: false }, { now }));
});

test('normalizeFollows: drops malformed + duplicate entries, coerces shape', () => {
  const f = normalizeFollows({
    following: [
      { username: 'Alice', addedAt: 5 },
      { username: 'alice', addedAt: 9 }, // dup after lowercase
      { username: '../bad' },            // invalid
      { nope: true },                    // no username
      'string',                          // not an object
    ],
    updatedAt: 7,
  });
  assert.deepEqual(f.following, [{ username: 'alice', addedAt: 5 }]);
  assert.equal(f.updatedAt, 7);
});

test('followingUsernames: returns the clean username list', () => {
  assert.deepEqual(followingUsernames({ following: [{ username: 'A' }, { username: 'b' }] }), ['a', 'b']);
  assert.deepEqual(followingUsernames(null), []);
});
