// SOW-058: the pure syndication queue core. No network, no secrets, injected `now`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQueueItem, dedupeKey, normalizeItem, isDue, planDrain, canCancel, markClaimed,
  recordChannel, channelDone, pendingChannels, markSent, markFailed, markCancelled,
  SyndicationError, DEFAULT_HOLD_MS,
} from '../membership/syndication-queue.mjs';

const at = (t) => () => t;

test('buildQueueItem computes availableAt from an injected now + holdMs and derives membersOnly', () => {
  const item = buildQueueItem(
    { source: 'post', targetSlug: 'members/alice/posts/x', title: 'Hi', url: 'https://gbti.network/x/', visibility: 'public' },
    { now: at(1000), holdMs: 60_000 },
  );
  assert.equal(item.status, 'pending');
  assert.equal(item.enqueuedAt, 1000);
  assert.equal(item.availableAt, 61_000);
  assert.equal(item.membersOnly, false);
  assert.equal(item.trigger, 'publish');
  assert.equal(dedupeKey(item), 'post:members/alice/posts/x');
  // default hold when not provided
  assert.equal(buildQueueItem({ source: 'post', targetSlug: 'x' }, { now: at(0) }).availableAt, DEFAULT_HOLD_MS);
});

test('buildQueueItem rejects a bad source and a missing targetSlug', () => {
  assert.throws(() => buildQueueItem({ source: 'banana', targetSlug: 'x' }), SyndicationError);
  assert.throws(() => buildQueueItem({ source: 'share', targetSlug: '   ' }), SyndicationError);
});

test('LEAK GUARD: a members-only item carries url/title/blurb but provably no body/encryptedBody', () => {
  const item = buildQueueItem(
    {
      source: 'share', targetSlug: 'alice/note-1', title: 'A read', blurb: 'why it matters',
      url: 'https://example.com/article', visibility: 'members',
      // a caller that wrongly passes the body must not leak it:
      body: 'SECRET MEMBER BODY', encryptedBody: 'members/alice/_enc/note-1.enc',
    },
    { now: at(5) },
  );
  assert.equal(item.membersOnly, true);
  assert.equal(item.url, 'https://example.com/article');
  assert.equal(item.title, 'A read');
  assert.equal(item.blurb, 'why it matters');
  // structurally: no body field exists, and serialized the secret never appears
  assert.ok(!('body' in item));
  assert.ok(!('encryptedBody' in item));
  assert.ok(!JSON.stringify(item).includes('SECRET MEMBER BODY'));
  assert.ok(!JSON.stringify(item).includes('.enc'));
});

test('normalizeItem coerces a stored value and drops an unusable one', () => {
  assert.equal(normalizeItem(null), null);
  assert.equal(normalizeItem({ id: 'x', source: 'nope', targetSlug: 'a' }), null); // bad source
  assert.equal(normalizeItem({ source: 'post', targetSlug: 'a' }), null); // no id
  const n = normalizeItem({ id: 'post:a#1', source: 'post', targetSlug: 'a', status: 'weird', enqueuedAt: '5', availableAt: '65' });
  assert.equal(n.status, 'pending'); // bad status -> pending
  assert.equal(n.enqueuedAt, 5);
  assert.equal(n.availableAt, 65);
  assert.deepEqual(n.perChannel, {});
});

test('isDue + planDrain enforce the hold window', () => {
  const a = buildQueueItem({ source: 'post', targetSlug: 'a' }, { now: at(0), holdMs: 100 }); // availableAt 100
  const b = buildQueueItem({ source: 'post', targetSlug: 'b' }, { now: at(0), holdMs: 100 });
  assert.equal(isDue(a, 99), false);
  assert.equal(isDue(a, 100), true);
  const sent = markSent(b, { now: at(0) });
  const { due, holding } = planDrain([a, sent], 150);
  assert.deepEqual(due.map((i) => i.targetSlug), ['a']); // a is due
  assert.deepEqual(holding, []); // the sent item is excluded entirely (not "holding")
});

test('canCancel + markCancelled: pending-unclaimed cancels; claimed or terminal does not', () => {
  const a = buildQueueItem({ source: 'share', targetSlug: 'me/x' }, { now: at(0) });
  assert.equal(canCancel(a), true);
  const c = markCancelled(a, { now: at(9), actor: '42' });
  assert.equal(c.status, 'cancelled');
  assert.equal(c.cancelledAt, 9);
  assert.equal(c.cancelledBy, '42');
  // a claimed item cannot be cancelled (the drain owns it)
  const claimed = markClaimed(a, { now: at(1) });
  assert.equal(canCancel(claimed), false);
  assert.equal(markCancelled(claimed, { now: at(2) }).status, 'pending'); // unchanged
  // an already-sent item cannot be cancelled
  assert.equal(canCancel(markSent(a, { now: at(1) })), false);
});

test('recordChannel + channelDone + pendingChannels track per-channel idempotency', () => {
  let item = buildQueueItem({ source: 'post', targetSlug: 'a' }, { now: at(0) });
  item = recordChannel(item, 'discord', { status: 'sent', id: 'm1' });
  item = recordChannel(item, 'x', { status: 'skipped', reason: 'not configured' });
  item = recordChannel(item, 'mastodon', { status: 'failed', error: '500' });
  assert.equal(channelDone(item, 'discord'), true); // sent -> done
  assert.equal(channelDone(item, 'x'), true); // skipped -> done
  assert.equal(channelDone(item, 'mastodon'), false); // failed -> retry
  assert.deepEqual(pendingChannels(item, ['discord', 'x', 'mastodon', 'bluesky']).sort(), ['bluesky', 'mastodon']);
});

test('markSent + markFailed set terminal status + timestamps', () => {
  const a = buildQueueItem({ source: 'post', targetSlug: 'a' }, { now: at(0) });
  assert.equal(markSent(a, { now: at(7) }).sentAt, 7);
  assert.equal(markFailed(a, { now: at(8) }).failedAt, 8);
});
