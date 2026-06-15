// SOW-007/008: resolving the per-content splitter inputs (contributor points + eligible commenters) from
// the git-native ledgers, and the username -> github_id inversion that keeps money keyed on immutable ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contributorsForContent, commentsForContent } from '../membership/distribution-inputs.mjs';
import { reverseMembersIndex, membersIndexFromParsed } from '../membership/overrides.mjs';
import { AWARD_STATUS } from '../membership/points.mjs';

// A real ledger award carries 1 reputation point per accepted contribution (points.mjs classToPoints).
// contributorsForContent scales that to the 7-point distribution unit, so one contribution = the full pool.
const award = (over) => ({
  contributor_github_id: '200',
  target: { username: 'alice', type: 'post', slug: 'hello' },
  points: 1,
  status: AWARD_STATUS.awarded,
  ...over,
});

// ---- contributorsForContent (returns the DISTRIBUTION WEIGHT = ledger points x 7) ----

test('sums effective points per contributor for the matching content only', () => {
  const awards = [
    award({ contributor_github_id: '200', points: 1 }),
    award({ contributor_github_id: '200', points: 1 }), // same contributor, 2 contributions -> 2 ledger pts -> weight 14
    award({ contributor_github_id: '300', points: 1 }),
    award({ contributor_github_id: '400', target: { type: 'post', slug: 'other' }, points: 1 }), // different content
    award({ contributor_github_id: '500', target: { type: 'product', slug: 'hello' }, points: 1 }), // different type
  ];
  const out = contributorsForContent(awards, 'post', 'hello').sort((a, b) => Number(a.id) - Number(b.id));
  assert.deepEqual(out, [{ id: '200', points: 14 }, { id: '300', points: 7 }]);
});

test('disputed / upheld-against awards count zero and drop out', () => {
  const awards = [
    award({ contributor_github_id: '200', status: AWARD_STATUS.authorRejected }), // pending -> 0
    award({ contributor_github_id: '300', status: AWARD_STATUS.adminUpheld }),     // upheld against -> 0
    award({ contributor_github_id: '400', status: AWARD_STATUS.awarded, points: 1 }),
  ];
  assert.deepEqual(contributorsForContent(awards, 'post', 'hello'), [{ id: '400', points: 7 }]);
});

test('a banned contributor earns nothing (fail closed)', () => {
  const awards = [award({ contributor_github_id: '200' }), award({ contributor_github_id: '300' })];
  const out = contributorsForContent(awards, 'post', 'hello', new Set(['200']));
  assert.deepEqual(out, [{ id: '300', points: 7 }]);
});

test('one accepted contribution claims the FULL pool (scaled to the 7-point unit, like a comment)', () => {
  const out = contributorsForContent([award({ contributor_github_id: '200', points: 1 })], 'post', 'hello');
  assert.deepEqual(out, [{ id: '200', points: 7 }]); // 1 ledger point x 7 = a full unit -> fills minPointsForFullPool
});

// ---- commentsForContent ----

const NOW = Date.parse('2026-06-04T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();
const idx = reverseMembersIndex(membersIndexFromParsed({ members: { '200': 'bob', '300': 'carol', '400': 'dave' } }));

const comment = (over) => ({ author: 'bob', targetType: 'post', targetSlug: 'hello', status: 'published', createdAt: daysAgo(10), ...over });

test('resolves authors to github_id, orders oldest-first, with 7 points each and computed ageDays', () => {
  const comments = [
    comment({ author: 'carol', createdAt: daysAgo(5) }),
    comment({ author: 'bob', createdAt: daysAgo(20) }),
  ];
  const out = commentsForContent(comments, 'post', 'hello', idx, NOW);
  assert.deepEqual(out, [
    { id: '200', points: 7, ageDays: 20 }, // bob, 20 days old -> first (oldest)
    { id: '300', points: 7, ageDays: 5 },  // carol, 5 days old
  ]);
});

test('drops comments whose author is not in the members index (cannot be paid)', () => {
  const comments = [comment({ author: 'stranger' }), comment({ author: 'bob' })];
  const out = commentsForContent(comments, 'post', 'hello', idx, NOW);
  assert.deepEqual(out.map((c) => c.id), ['200']);
});

test('drops draft comments and comments targeting other content', () => {
  const comments = [
    comment({ author: 'bob', status: 'draft' }),
    comment({ author: 'carol', targetSlug: 'other' }),
    comment({ author: 'dave' }),
  ];
  assert.deepEqual(commentsForContent(comments, 'post', 'hello', idx, NOW).map((c) => c.id), ['400']);
});

test('a banned commenter is dropped; an unparseable timestamp gets a MAX age so the window excludes it', () => {
  const banned = commentsForContent([comment({ author: 'bob' })], 'post', 'hello', idx, NOW, { bannedGithubIds: new Set(['200']) });
  assert.deepEqual(banned, []);
  const noTime = commentsForContent([comment({ author: 'carol', createdAt: 'not-a-date' })], 'post', 'hello', idx, NOW);
  assert.equal(noTime[0].ageDays, Number.MAX_SAFE_INTEGER);
});

test('a FUTURE-dated comment is not treated as fresh (fails the <90-day window, fail-closed)', () => {
  const future = [comment({ author: 'bob', createdAt: daysAgo(-365) })]; // 365 days in the future
  const out = commentsForContent(future, 'post', 'hello', idx, NOW);
  assert.equal(out[0].ageDays, Number.MAX_SAFE_INTEGER, 'a future timestamp cannot masquerade as age 0');
});

// ---- reverseMembersIndex ----

test('reverseMembersIndex inverts to lowercased username -> github_id', () => {
  const fwd = membersIndexFromParsed({ members: { '7': 'Alice', '8': 'BOB' } });
  const rev = reverseMembersIndex(fwd);
  assert.equal(rev.get('alice'), '7');
  assert.equal(rev.get('bob'), '8');
  assert.equal(rev.get('Alice'), undefined); // keys are lowercased
});
