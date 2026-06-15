// SOW-026: the gate's bot-aware author resolution. When GBTI's App bot opens the publish PR on a member's
// behalf, the trust anchor is the PR HEAD (the fork owner), not the opener.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent } from '../scripts/pr-gate.mjs';

const BOT = 555;
const ev = ({ openerId, headOwnerId, headSha = 'abc' } = {}) => ({
  number: 10,
  pull_request: {
    number: 10,
    user: { id: openerId },
    head: { sha: headSha, user: { id: headOwnerId }, repo: { owner: { id: headOwnerId } } },
  },
});

test('a member opening their own PR directly: author = the opener (unchanged behavior)', () => {
  const r = parseEvent(ev({ openerId: 1, headOwnerId: 1 }), BOT);
  assert.equal(r.author, 1);
  assert.equal(r.botOpened, false);
});

test('the App bot opens the PR: author resolves to the PR head owner (the fork owner)', () => {
  const r = parseEvent(ev({ openerId: BOT, headOwnerId: 42 }), BOT);
  assert.equal(r.author, 42, 'the member (fork owner), not the bot');
  assert.equal(r.botOpened, true);
});

test('without a botId configured, behavior is the legacy opener-as-author', () => {
  const r = parseEvent(ev({ openerId: 7, headOwnerId: 9 }), null);
  assert.equal(r.author, 7);
  assert.equal(r.botOpened, false);
});

test('a bot-opened PR with no resolvable head owner fails closed (author null)', () => {
  const event = { number: 1, pull_request: { number: 1, user: { id: BOT }, head: { sha: 's', user: null, repo: null } } };
  const r = parseEvent(event, BOT);
  assert.equal(r.author, null, 'no head owner -> null -> the gate throws (fail closed)');
  assert.equal(r.botOpened, true);
});

test('an event with no pull_request throws', () => {
  assert.throws(() => parseEvent({}, BOT), /no pull_request/);
});
