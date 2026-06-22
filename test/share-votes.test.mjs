// SOW-057: the pure per-target share-vote core. No network, no secrets, injected `now`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyShareVotes, normalizeShareVotes, applyShareVote, distinctNonAuthorCount, shouldEnqueue,
  markEnqueued, scrubVoter, ShareVoteError,
} from '../membership/share-votes.mjs';

const at = (t) => () => t;
const AUTHOR = 'author-1';

test('applyShareVote adds/removes voters idempotently and caches the author', () => {
  let r = applyShareVote(emptyShareVotes(), { voterId: 'v1', authorId: AUTHOR, on: true }, { now: at(10) });
  assert.deepEqual(r.voters, ['v1']);
  assert.equal(r.author, AUTHOR);
  // adding the same voter again is a no-op
  r = applyShareVote(r, { voterId: 'v1', authorId: AUTHOR, on: true }, { now: at(11) });
  assert.deepEqual(r.voters, ['v1']);
  // remove
  r = applyShareVote(r, { voterId: 'v1', on: false }, { now: at(12) });
  assert.deepEqual(r.voters, []);
  // a missing voterId throws
  assert.throws(() => applyShareVote(emptyShareVotes(), { voterId: '', on: true }), ShareVoteError);
});

test('distinctNonAuthorCount excludes the author own vote', () => {
  let r = emptyShareVotes();
  r = applyShareVote(r, { voterId: AUTHOR, authorId: AUTHOR, on: true }, { now: at(1) }); // author upvotes own share
  r = applyShareVote(r, { voterId: 'v1', on: true }, { now: at(2) });
  assert.equal(r.voters.length, 2);
  assert.equal(distinctNonAuthorCount(r), 1); // author does not count
});

test('shouldEnqueue: author + 2 distinct members crosses threshold 2 (author excluded)', () => {
  let r = emptyShareVotes();
  r = applyShareVote(r, { voterId: AUTHOR, authorId: AUTHOR, on: true }, { now: at(1) });
  r = applyShareVote(r, { voterId: 'v1', on: true }, { now: at(2) });
  assert.equal(shouldEnqueue(r, 2), false); // only one non-author voter
  r = applyShareVote(r, { voterId: 'v2', on: true }, { now: at(3) });
  assert.equal(shouldEnqueue(r, 2), true); // two distinct non-author voters
});

test('shouldEnqueue works when the author never self-upvotes (author excluded at vote time, not here)', () => {
  // The Worker never adds the author to the voter set (it detects author-ness by github_login), so a set of two
  // distinct non-author voters crosses the threshold even though the cached author id is still null.
  let r = emptyShareVotes();
  r = applyShareVote(r, { voterId: 'v1', on: true }, { now: at(1) });
  r = applyShareVote(r, { voterId: 'v2', on: true }, { now: at(2) });
  assert.equal(r.author, null);
  assert.equal(shouldEnqueue(r, 2), true);
});

test('idempotency by watermark: once enqueued, never enqueue again even as votes churn', () => {
  let r = emptyShareVotes();
  r = applyShareVote(r, { voterId: 'v1', authorId: AUTHOR, on: true }, { now: at(1) });
  r = applyShareVote(r, { voterId: 'v2', on: true }, { now: at(2) });
  assert.equal(shouldEnqueue(r, 2), true);
  r = markEnqueued(r, { now: at(3) });
  assert.equal(r.enqueuedAt, 3);
  assert.equal(shouldEnqueue(r, 2), false); // watermark set -> never again
  // a third voter arrives
  r = applyShareVote(r, { voterId: 'v3', on: true }, { now: at(4) });
  assert.equal(shouldEnqueue(r, 2), false);
  // removing voters back below threshold does NOT un-enqueue
  r = applyShareVote(r, { voterId: 'v2', on: false }, { now: at(5) });
  r = applyShareVote(r, { voterId: 'v3', on: false }, { now: at(6) });
  assert.equal(distinctNonAuthorCount(r), 1);
  assert.equal(r.enqueuedAt, 3); // still enqueued
});

test('a higher threshold needs more distinct voters', () => {
  let r = emptyShareVotes();
  r = applyShareVote(r, { voterId: 'v1', authorId: AUTHOR, on: true }, { now: at(1) });
  r = applyShareVote(r, { voterId: 'v2', on: true }, { now: at(2) });
  assert.equal(shouldEnqueue(r, 3), false);
  r = applyShareVote(r, { voterId: 'v3', on: true }, { now: at(3) });
  assert.equal(shouldEnqueue(r, 3), true);
});

test('normalizeShareVotes dedupes voters and coerces watermarks', () => {
  const r = normalizeShareVotes({ voters: ['a', 'a', 'b', null, '  '], author: 'a', enqueuedAt: '7', updatedAt: 'x' });
  assert.deepEqual(r.voters, ['a', 'b']);
  assert.equal(r.author, 'a');
  assert.equal(r.enqueuedAt, 7);
  assert.equal(r.updatedAt, null); // non-numeric -> null
});

test('scrubVoter removes a github_id (GDPR) and clears it as author when it matches', () => {
  let r = emptyShareVotes();
  r = applyShareVote(r, { voterId: 'v1', authorId: AUTHOR, on: true }, { now: at(1) });
  r = applyShareVote(r, { voterId: 'v2', on: true }, { now: at(2) });
  const out = scrubVoter(r, 'v1', { now: at(9) });
  assert.equal(out.changed, true);
  assert.deepEqual(out.record.voters, ['v2']);
  // erasing the author clears the cached author id too
  const authorErased = scrubVoter(out.record, AUTHOR, { now: at(10) });
  assert.equal(authorErased.record.author, null);
  // scrubbing an absent id is a no-op
  assert.equal(scrubVoter(out.record, 'nobody').changed, false);
});
