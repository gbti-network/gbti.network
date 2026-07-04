// SOW-111: the per-item news detail-open record (the share-votes clone). Pure; injected now; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyNewsOpens, normalizeNewsOpens, applyOpen, distinctOpenerCount, shouldPost, markPosted, scrubOpener,
  NewsOpenError,
} from '../membership/news-opens.mjs';

const at = (t) => () => t;

test('normalizeNewsOpens dedupes openers and coerces watermarks; garbage yields the empty record', () => {
  const r = normalizeNewsOpens({ openers: ['1', '1', 2, '', null], postedAt: '5', updatedAt: 'x' });
  assert.deepEqual(r.openers, ['1', '2']);
  assert.equal(r.postedAt, 5);
  assert.equal(r.updatedAt, null);
  assert.deepEqual(normalizeNewsOpens(null), emptyNewsOpens());
  assert.deepEqual(normalizeNewsOpens('junk'), emptyNewsOpens());
});

test('applyOpen adds a distinct opener once; a re-open only bumps updatedAt', () => {
  let r = applyOpen(emptyNewsOpens(), { openerId: '42' }, { now: at(1) });
  r = applyOpen(r, { openerId: '42' }, { now: at(2) });
  r = applyOpen(r, { openerId: '7' }, { now: at(3) });
  assert.deepEqual(r.openers, ['42', '7']);
  assert.equal(distinctOpenerCount(r), 2);
  assert.equal(r.updatedAt, 3);
  assert.throws(() => applyOpen(r, { openerId: '' }), NewsOpenError);
});

test('shouldPost trips at the threshold once, never after the watermark, and floors bad thresholds to 2', () => {
  let r = applyOpen(emptyNewsOpens(), { openerId: 'a' }, { now: at(1) });
  assert.equal(shouldPost(r, 2), false);
  r = applyOpen(r, { openerId: 'b' }, { now: at(2) });
  assert.equal(shouldPost(r, 2), true);
  assert.equal(shouldPost(r, 'not-a-number'), true); // default threshold 2
  assert.equal(shouldPost(r, 0), true); // floor 1
  r = markPosted(r, { now: at(3) });
  assert.equal(r.postedAt, 3);
  assert.equal(shouldPost(r, 2), false); // watermark: never again
  r = applyOpen(r, { openerId: 'c' }, { now: at(4) });
  assert.equal(shouldPost(r, 2), false);
});

test('scrubOpener removes the erased id (GDPR) and reports changed', () => {
  const r = applyOpen(applyOpen(emptyNewsOpens(), { openerId: 'x' }, { now: at(1) }), { openerId: 'y' }, { now: at(2) });
  const hit = scrubOpener(r, 'x', { now: at(9) });
  assert.equal(hit.changed, true);
  assert.deepEqual(hit.record.openers, ['y']);
  assert.equal(hit.record.updatedAt, 9);
  const miss = scrubOpener(hit.record, 'zzz', { now: at(10) });
  assert.equal(miss.changed, false);
});
